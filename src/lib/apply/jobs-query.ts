import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import type { JobBoardId } from "@/lib/apply/types";
import { isBoardLive, PROVIDER_CAPABILITIES } from "@/lib/apply/registry";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";

export const JOB_SORTS = ["newest", "score", "company", "provider"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

export const JOB_MATCH_STATUSES = ["pending", "scored", "drafted", "queued", "dismissed"] as const;
export type JobMatchStatus = (typeof JOB_MATCH_STATUSES)[number];

export const DEFAULT_JOB_PAGE_SIZE = 25;
export const MAX_JOB_PAGE_SIZE = 100;

export interface JobsQuery {
  q?: string | null;
  board?: string | null;
  city?: string | null;
  status?: string | null;
  applied?: string | null;
  sort?: JobSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface ParsedJobsQuery {
  q: string | null;
  board: JobBoardId | null;
  city: string | null;
  status: JobMatchStatus | null;
  applied: "all" | "not_applied" | "applied";
  sort: JobSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface UnifiedJobRow {
  id: string;
  board: JobBoardId;
  providerName: string;
  providerWorkflowState: "live" | "in_progress" | "planned";
  title: string;
  company: string | null;
  city: string | null;
  url: string;
  description: string | null;
  salary: string | null;
  postedAt: Date | null;
  ingestedAt: Date;
  lastSeenAt: Date;
  updatedAt: Date;
  matchId: string | null;
  matchScore: number | null;
  matchStatus: JobMatchStatus | null;
  matchReason: string | null;
  applicationId: string | null;
  applicationStatus: "draft" | "submitted" | "skipped" | "failed" | null;
  providerApplicationId: string | null;
  providerStatus: string | null;
  providerAppliedAt: Date | null;
  accountStatus: "connected" | "expired" | "needs_reauth" | null;
  canEasyApply: boolean;
  alreadyApplied: boolean;
}

export interface UnifiedJobsPage {
  items: UnifiedJobRow[];
  filteredTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function parseJobsQuery(params: Record<string, string | undefined>): ParsedJobsQuery {
  const q = params.q?.trim() ? params.q.trim().slice(0, 80) : null;
  const board = Object.keys(PROVIDER_CAPABILITIES).includes(params.board ?? "")
    ? (params.board as JobBoardId)
    : null;
  const city = params.city?.trim() ? params.city.trim().slice(0, 80) : null;
  const status = (JOB_MATCH_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as JobMatchStatus)
    : null;
  const applied =
    params.applied === "applied" || params.applied === "all" ? params.applied : "not_applied";
  const sort = (JOB_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as JobSort)
    : "newest";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rawSize = Number.parseInt(params.pageSize ?? "", 10);
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(MAX_JOB_PAGE_SIZE, Math.max(5, rawSize))
    : DEFAULT_JOB_PAGE_SIZE;
  return { q, board, city, status, applied, sort, dir, page, pageSize };
}

const JOB_KEY_L = sql.raw(
  `regexp_replace(l.url, '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);
const JOB_KEY_PROVIDER = sql.raw(
  `regexp_replace(coalesce(ba.url, ''), '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);

function whereSql(userId: string, query: ParsedJobsQuery) {
  const filters = [
    sql`l.posted_at >= now() - (${MAX_PROVIDER_SYNC_AGE_DAYS}::text || ' days')::interval`,
  ];

  if (query.board) filters.push(sql`l.board = ${query.board}`);
  if (query.city) filters.push(sql`l.city ilike ${"%" + query.city + "%"}`);
  if (query.status) filters.push(sql`m.status = ${query.status}`);
  if (query.q) {
    const q = "%" + query.q + "%";
    filters.push(sql`
      (l.title ilike ${q}
        or l.company ilike ${q}
        or l.city ilike ${q}
        or l.description ilike ${q})
    `);
  }
  if (query.applied === "not_applied") {
    filters.push(sql`app.id is null and provider_app.id is null`);
  } else if (query.applied === "applied") {
    filters.push(sql`(app.id is not null or provider_app.id is not null)`);
  }

  return sql.join(filters, sql` and `);
}

function orderSql(query: ParsedJobsQuery) {
  const field = {
    newest: sql`l.posted_at`,
    score: sql`m.score`,
    company: sql`l.company`,
    provider: sql`l.board`,
  }[query.sort];
  const direction = query.dir === "asc" ? sql`asc nulls last` : sql`desc nulls last`;
  return sql`${field} ${direction}, l.updated_at desc`;
}

export async function listUnifiedJobsPage(
  userId: string,
  query: JobsQuery = {},
  deps: { db?: Database } = {},
): Promise<UnifiedJobsPage> {
  const conn = deps.db ?? defaultDb;
  const parsed = parseJobsQuery({
    q: query.q ?? undefined,
    board: query.board ?? undefined,
    city: query.city ?? undefined,
    status: query.status ?? undefined,
    applied: query.applied ?? undefined,
    sort: query.sort,
    dir: query.dir,
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? DEFAULT_JOB_PAGE_SIZE),
  });
  const where = whereSql(userId, parsed);

  const [{ n: filteredTotal } = { n: 0 }] = (await conn.execute<{ n: number }>(sql`
    select count(*)::int as n
    from job_listings l
    left join matches m on m.user_id = ${userId} and m.listing_id = l.id
    left join applications app on app.user_id = ${userId} and app.listing_id = l.id and app.status in ('draft', 'submitted')
    left join lateral (
      select ba.id, ba.status_category, ba.applied_at
      from board_applications ba
      where ba.user_id = ${userId}
        and ba.board = l.board::text
        and (ba.url = l.url or ${JOB_KEY_PROVIDER} = ${JOB_KEY_L})
      order by ba.last_seen_at desc
      limit 1
    ) provider_app on true
    where ${where}
  `)) as unknown as { n: number }[];

  const rows = (await conn.execute(sql`
    select
      l.id,
      l.board::text as board,
      l.title,
      l.company,
      l.city,
      l.url,
      l.description,
      l.salary,
      l.posted_at,
      l.ingested_at,
      l.last_seen_at,
      l.updated_at,
      m.id as match_id,
      m.score as match_score,
      m.status::text as match_status,
      m.reason as match_reason,
      app.id as application_id,
      app.status::text as application_status,
      provider_app.id as provider_application_id,
      provider_app.status_category::text as provider_status,
      provider_app.applied_at as provider_applied_at,
      acct.status::text as account_status
    from job_listings l
    left join matches m on m.user_id = ${userId} and m.listing_id = l.id
    left join applications app on app.user_id = ${userId} and app.listing_id = l.id and app.status in ('draft', 'submitted')
    left join lateral (
      select ba.id, ba.status_category, ba.applied_at, ba.url, ba.last_seen_at
      from board_applications ba
      where ba.user_id = ${userId}
        and ba.board = l.board::text
        and (ba.url = l.url or ${JOB_KEY_PROVIDER} = ${JOB_KEY_L})
      order by ba.last_seen_at desc
      limit 1
    ) provider_app on true
    left join board_accounts acct on acct.user_id = ${userId} and acct.board = l.board
    where ${where}
    order by ${orderSql(parsed)}
    limit ${parsed.pageSize} offset ${(parsed.page - 1) * parsed.pageSize}
  `)) as unknown as Record<string, unknown>[];

  const items = rows.map((row): UnifiedJobRow => {
    const board = row.board as JobBoardId;
    const provider = PROVIDER_CAPABILITIES[board];
    const applicationId = (row.application_id as string | null) ?? null;
    const providerApplicationId = (row.provider_application_id as string | null) ?? null;
    const alreadyApplied = Boolean(applicationId || providerApplicationId);
    const accountStatus = (row.account_status as UnifiedJobRow["accountStatus"]) ?? null;
    return {
      id: row.id as string,
      board,
      providerName: provider?.displayName ?? board,
      providerWorkflowState: provider?.workflowState ?? "planned",
      title: row.title as string,
      company: (row.company as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      url: row.url as string,
      description: (row.description as string | null) ?? null,
      salary: (row.salary as string | null) ?? null,
      postedAt: row.posted_at ? new Date(row.posted_at as string) : null,
      ingestedAt: new Date(row.ingested_at as string),
      lastSeenAt: new Date(row.last_seen_at as string),
      updatedAt: new Date(row.updated_at as string),
      matchId: (row.match_id as string | null) ?? null,
      matchScore: typeof row.match_score === "number" ? row.match_score : null,
      matchStatus: (row.match_status as JobMatchStatus | null) ?? null,
      matchReason: (row.match_reason as string | null) ?? null,
      applicationId,
      applicationStatus: (row.application_status as UnifiedJobRow["applicationStatus"]) ?? null,
      providerApplicationId,
      providerStatus: (row.provider_status as string | null) ?? null,
      providerAppliedAt: row.provider_applied_at ? new Date(row.provider_applied_at as string) : null,
      accountStatus,
      canEasyApply: isBoardLive(board) && accountStatus === "connected" && !alreadyApplied,
      alreadyApplied,
    };
  });

  return {
    items,
    filteredTotal,
    page: parsed.page,
    pageSize: parsed.pageSize,
    pageCount: Math.max(1, Math.ceil(filteredTotal / parsed.pageSize)),
  };
}
