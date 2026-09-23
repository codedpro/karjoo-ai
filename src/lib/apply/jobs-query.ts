import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import type { JobBoardId } from "@/lib/apply/types";
import { isBoardApplyable, PROVIDER_CAPABILITIES } from "@/lib/apply/registry";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";
import {
  ACTIVE_BOARDS,
  parseUnifiedJobFilters,
  type EmploymentTypeFilter,
  type UnifiedJobFilters,
} from "@/lib/apply/job-filter-options";

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
  category?: string | null;
  type?: string | null;
  /** "1"/true when parsed from a URL or passed back already parsed. */
  remote?: string | boolean | null;
  posted?: string | number | null;
  status?: string | null;
  applied?: string | null;
  sort?: JobSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface ParsedJobsQuery extends UnifiedJobFilters {
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
  /** Unified attributes — the same vocabulary on every board. */
  category: string | null;
  employmentType: EmploymentTypeFilter | null;
  isRemote: boolean;
  cityNorm: string | null;
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
  applicationStatus: "draft" | "verifying" | "submitted" | "skipped" | "failed" | null;
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
  // The shared filters (search, site, category, city, job type, remote, posted)
  // come from ONE parser so every list reads a URL the same way.
  const unified = parseUnifiedJobFilters(params);
  const status = (JOB_MATCH_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as JobMatchStatus)
    : null;
  const applied =
    params.applied === "applied" || params.applied === "not_applied" ? params.applied : "all";
  const sort = (JOB_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as JobSort)
    : "newest";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rawSize = Number.parseInt(params.pageSize ?? "", 10);
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(MAX_JOB_PAGE_SIZE, Math.max(5, rawSize))
    : DEFAULT_JOB_PAGE_SIZE;
  return { ...unified, status, applied, sort, dir, page, pageSize };
}

const JOB_KEY_L = sql.raw(
  `regexp_replace(l.url, '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);
const JOB_KEY_PROVIDER = sql.raw(
  `regexp_replace(coalesce(ba.url, ''), '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);

/**
 * The user's provider-side applications, keyed once by normalized job URL.
 *
 * Matching each listing with a per-row regex over every provider application was
 * listings × applications regex calls (minutes for an active user); an equality
 * join on a precomputed key is a single hash join. Identical URLs produce
 * identical keys, so this still covers the exact-URL match.
 */
function providerAppsCte(userId: string | null) {
  return sql`
    with provider_app as materialized (
      select distinct on (ba.board, job_key)
        ba.id, ba.board, ba.status_category, ba.applied_at, job_key
      from board_applications ba
      cross join lateral (select ${JOB_KEY_PROVIDER} as job_key) k
      where ba.user_id = ${userId}
        and ba.url is not null
      order by ba.board, job_key, ba.last_seen_at desc
    )
  `;
}

/**
 * The WHERE clause every job list shares. Job lists are restricted to fresh
 * listings on the active sites: listings from boards Karjoo cannot apply on (or
 * hand-entered ones) are not advertised as if they were. The archive of what was
 * already sent passes `history: true` — an application from two months ago must
 * stay findable with the very same filters.
 */
export function unifiedListingWhere(
  filters: UnifiedJobFilters,
  alias = "l",
  opts: { history?: boolean } = {},
) {
  const col = (name: string) => sql.raw(`${alias}.${name}`);
  const parts = opts.history
    ? []
    : [
        sql`${col("posted_at")} >= now() - (${MAX_PROVIDER_SYNC_AGE_DAYS}::text || ' days')::interval`,
        sql`${col("board")}::text in (${sql.join(
          ACTIVE_BOARDS.map((b) => sql`${b}`),
          sql`, `,
        )})`,
      ];
  if (filters.board) parts.push(sql`${col("board")} = ${filters.board}`);
  if (filters.category) parts.push(sql`${col("category")} = ${filters.category}`);
  if (filters.type) parts.push(sql`${col("employment_type")} = ${filters.type}`);
  if (filters.remote) parts.push(sql`${col("is_remote")}`);
  if (filters.posted) {
    parts.push(sql`${col("posted_at")} >= now() - (${filters.posted}::text || ' days')::interval`);
  }
  // City is a picked value from the cleaned city list; the prefix match keeps a
  // hand-typed «تهران» working too.
  if (filters.city) parts.push(sql`${col("city_norm")} ilike ${filters.city + "%"}`);
  if (filters.q) {
    const q = "%" + filters.q + "%";
    parts.push(sql`
      (${col("title")} ilike ${q}
        or ${col("company")} ilike ${q}
        or ${col("city")} ilike ${q}
        or ${col("description")} ilike ${q})
    `);
  }
  return parts;
}

function whereSql(query: ParsedJobsQuery) {
  const filters = unifiedListingWhere(query);
  if (query.status) filters.push(sql`m.status = ${query.status}`);
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
  userId: string | null,
  query: JobsQuery = {},
  deps: { db?: Database } = {},
): Promise<UnifiedJobsPage> {
  const conn = deps.db ?? defaultDb;
  const parsed = parseJobsQuery({
    q: query.q ?? undefined,
    board: query.board ?? undefined,
    city: query.city ?? undefined,
    category: query.category ?? undefined,
    type: query.type ?? undefined,
    remote: query.remote === true || query.remote === "1" ? "1" : undefined,
    posted: query.posted != null ? String(query.posted) : undefined,
    status: query.status ?? undefined,
    applied: query.applied ?? undefined,
    sort: query.sort,
    dir: query.dir,
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? DEFAULT_JOB_PAGE_SIZE),
  });
  const where = whereSql(parsed);

  const providerApps = providerAppsCte(userId);

  const [{ n: filteredTotal } = { n: 0 }] = (await conn.execute<{ n: number }>(sql`
    ${providerApps}
    select count(*)::int as n
    from job_listings l
    left join matches m on m.user_id = ${userId} and m.listing_id = l.id
    left join applications app on app.user_id = ${userId}
      and app.listing_id = l.id
      and app.status = 'submitted'
      and (app.external_ref is not null or app.proof is not null)
    left join provider_app
      on provider_app.board = l.board::text
      and provider_app.job_key = ${JOB_KEY_L}
    where ${where}
  `)) as unknown as { n: number }[];

  const rows = (await conn.execute(sql`
    ${providerApps}
    select
      l.id,
      l.board::text as board,
      l.title,
      l.company,
      l.city,
      l.category,
      l.employment_type,
      l.is_remote,
      l.city_norm,
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
    left join applications app on app.user_id = ${userId}
      and app.listing_id = l.id
      and app.status = 'submitted'
      and (app.external_ref is not null or app.proof is not null)
    left join provider_app
      on provider_app.board = l.board::text
      and provider_app.job_key = ${JOB_KEY_L}
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
      category: (row.category as string | null) ?? null,
      employmentType: (row.employment_type as EmploymentTypeFilter | null) ?? null,
      isRemote: row.is_remote === true,
      cityNorm: (row.city_norm as string | null) ?? null,
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
      canEasyApply: isBoardApplyable(board) && accountStatus === "connected" && !alreadyApplied,
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


/**
 * The cities to offer in the city filter: the cleaned city names that actually
 * have live listings on the active sites, busiest first.
 */
export async function listJobCityOptions(
  limit = 40,
  deps: { db?: Database } = {},
): Promise<Array<{ city: string; count: number }>> {
  const conn = deps.db ?? defaultDb;
  const rows = (await conn.execute(sql`
    select l.city_norm as city, count(*)::int as n
      from job_listings l
     where l.city_norm is not null
       and ${sql.join(unifiedListingWhere(parseUnifiedJobFilters({})), sql` and `)}
     group by l.city_norm
     order by n desc
     limit ${limit}
  `)) as unknown as { city: string; n: number }[];
  return rows.map((row) => ({ city: row.city, count: row.n }));
}
