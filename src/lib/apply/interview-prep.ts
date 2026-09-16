import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";

export type InterviewPrepDb = typeof defaultDb;

export type InterviewPrepStatus =
  | "queued"
  | "applying"
  | "verifying"
  | "submitted"
  | "failed"
  | "skipped"
  | "dead"
  | "draft";

export interface InterviewPrepRow {
  applicationId: string | null;
  taskId: string | null;
  matchId: string;
  listingId: string;
  status: InterviewPrepStatus;
  taskStatus: string | null;
  applicationStatus: string | null;
  attempts: number;
  lastError: string | null;
  reason: string | null;
  channel: "extension" | "worker" | null;
  happenedAt: string;
  submittedAt: string | null;
  createdAt: string;
  hasResume: boolean;
  listing: {
    board: string;
    title: string;
    company: string | null;
    city: string | null;
    url: string;
    description: string | null;
    postedAt: string | null;
  };
}

export interface InterviewPrepSummary {
  total: number;
  queued: number;
  applying: number;
  verifying: number;
  submitted: number;
  failed: number;
  skipped: number;
  dead: number;
}

export interface InterviewPrepData {
  summary: InterviewPrepSummary;
  rows: InterviewPrepRow[];
  /** Rows matching the current status + search, across all pages. */
  filteredTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
  updatedAt: string;
}

export const INTERVIEW_PREP_FILTERS = [
  "all",
  "queued",
  "applying",
  "verifying",
  "submitted",
  "failed",
  "skipped",
  "dead",
] as const;
export type InterviewPrepFilter = (typeof INTERVIEW_PREP_FILTERS)[number];

export interface InterviewPrepQuery {
  q: string;
  status: InterviewPrepFilter;
  page: number;
}

export const INTERVIEW_PREP_PAGE_SIZE = 30;

export function parseInterviewPrepQuery(
  params: Record<string, string | undefined>,
): InterviewPrepQuery {
  const q = (params.q ?? "").trim().slice(0, 120);
  const status = (INTERVIEW_PREP_FILTERS as readonly string[]).includes(params.status ?? "")
    ? (params.status as InterviewPrepFilter)
    : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  return { q, status, page };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Mirrors the precedence of the row status so filtering happens in SQL. */
const STATUS_SQL = sql.raw(`
  case
    when a.status::text = 'submitted' then 'submitted'
    when a.status::text = 'verifying' or t.status::text = 'verifying' then 'verifying'
    when a.status::text = 'failed' then 'failed'
    when a.status::text = 'skipped' then 'skipped'
    when t.status::text = 'pending' then 'queued'
    when t.status::text = 'leased' then 'applying'
    when t.status::text = 'dead' then 'dead'
    else 'draft'
  end
`);

export async function getInterviewPrepData(
  userId: string,
  opts: Partial<InterviewPrepQuery> & { pageSize?: number; db?: InterviewPrepDb } = {},
): Promise<InterviewPrepData> {
  const conn = opts.db ?? defaultDb;
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? INTERVIEW_PREP_PAGE_SIZE, 100));
  const status = opts.status ?? "all";
  const q = opts.q?.trim() ?? "";

  const base = sql`
    with base as (
      select
        a.id as application_id,
        t.id as task_id,
        m.id as match_id,
        l.id as listing_id,
        t.status as task_status,
        a.status as application_status,
        coalesce(t.attempts, 0) as attempts,
        t.last_error,
        a.reason,
        a.channel,
        a.submitted_at,
        coalesce(a.updated_at, t.updated_at, m.updated_at, m.created_at) as happened_at,
        coalesce(a.created_at, t.created_at, m.created_at) as created_at,
        ${STATUS_SQL} as row_status,
        l.board,
        l.title,
        l.company,
        l.city,
        l.url,
        l.description,
        l.posted_at
      from matches m
      inner join job_listings l on l.id = m.listing_id
      left join tasks t on t.match_id = m.id
      left join applications a on a.match_id = m.id
      where m.user_id = ${userId}
        and (t.id is not null or a.id is not null)
    )
  `;

  const searchSql = q
    ? sql`(title ilike ${"%" + q + "%"}
        or company ilike ${"%" + q + "%"}
        or city ilike ${"%" + q + "%"}
        or board::text ilike ${"%" + q + "%"}
        or reason ilike ${"%" + q + "%"}
        or last_error ilike ${"%" + q + "%"}
        or description ilike ${"%" + q + "%"})`
    : sql`true`;
  const statusSql = status === "all" ? sql`true` : sql`row_status = ${status}`;

  const countRows = (await conn.execute(sql`
    ${base}
    select
      row_status,
      count(*)::int as total,
      count(*) filter (where ${searchSql})::int as matching
    from base
    group by row_status
  `)) as unknown as { row_status: string; total: number; matching: number }[];

  const summary: InterviewPrepSummary = {
    total: 0,
    queued: 0,
    applying: 0,
    verifying: 0,
    submitted: 0,
    failed: 0,
    skipped: 0,
    dead: 0,
  };
  let filteredTotal = 0;
  for (const row of countRows) {
    const total = Number(row.total);
    summary.total += total;
    if (row.row_status in summary && row.row_status !== "total") {
      summary[row.row_status as keyof InterviewPrepSummary] += total;
    }
    if (status === "all" || row.row_status === status) filteredTotal += Number(row.matching);
  }

  const pageCount = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pageCount);

  const rows = await conn.execute(sql`
    ${base}
    select
      base.*,
      exists (
        select 1
        from resumes r
        where r.user_id = ${userId}
          and r.listing_id = base.listing_id
          and r.is_base = false
      ) as has_resume
    from base
    where ${statusSql} and ${searchSql}
    order by happened_at desc, match_id
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `);

  const mapped: InterviewPrepRow[] = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    applicationId: r.application_id ? String(r.application_id) : null,
    taskId: r.task_id ? String(r.task_id) : null,
    matchId: String(r.match_id),
    listingId: String(r.listing_id),
    status: r.row_status as InterviewPrepStatus,
    taskStatus: (r.task_status as string | null) ?? null,
    applicationStatus: (r.application_status as string | null) ?? null,
    attempts: Number(r.attempts ?? 0),
    lastError: (r.last_error as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    channel: (r.channel as "extension" | "worker" | null) ?? null,
    happenedAt: iso(r.happened_at) ?? new Date().toISOString(),
    submittedAt: iso(r.submitted_at),
    createdAt: iso(r.created_at) ?? new Date().toISOString(),
    hasResume: r.has_resume === true,
    listing: {
      board: String(r.board),
      title: String(r.title),
      company: (r.company as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      url: String(r.url),
      description: (r.description as string | null) ?? null,
      postedAt: iso(r.posted_at),
    },
  }));

  return {
    summary,
    rows: mapped,
    filteredTotal,
    page,
    pageSize,
    pageCount,
    updatedAt: new Date().toISOString(),
  };
}

export async function retryFailedApplication(
  userId: string,
  applicationId: string,
  conn: InterviewPrepDb = defaultDb,
): Promise<{ ok: true; taskId: string } | { ok: false; reason: string }> {
  const rows = await conn.execute(sql`
    select
      a.id as application_id,
      a.status as application_status,
      a.external_ref,
      a.proof,
      a.match_id,
      t.id as task_id,
      t.status as task_status,
      cp.preferences ->> 'gender' as gender,
      l.title,
      coalesce(l.description, '') as description
    from applications a
    inner join matches m on m.id = a.match_id
    inner join job_listings l on l.id = a.listing_id
    left join tasks t on t.match_id = a.match_id
    left join candidate_profiles cp on cp.user_id = a.user_id
    where a.id = ${applicationId}
      and a.user_id = ${userId}
    limit 1
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  if (!row) return { ok: false, reason: "not_found" };
  const unconfirmedSubmitted =
    row.application_status === "submitted" && !row.external_ref && !row.proof;
  if (row.application_status !== "failed" && !unconfirmedSubmitted) {
    return { ok: false, reason: "not_retryable" };
  }
  if (!row.task_id) return { ok: false, reason: "no_task" };

  const text = `${row.title ?? ""}\n${row.description ?? ""}`.toLowerCase();
  const femaleOnly =
    /(^|[\s(（\\/،؛:-])خانم($|[\s)）\\/،؛:-])/.test(text) ||
    /جنسیت[^\n]{0,40}خانم/.test(text) ||
    /(?:female|woman|women)\s*[- ]?\s*only/.test(text) ||
    /\bonly\s+(?:female|woman|women)\b/.test(text);
  if (row.gender === "male" && femaleOnly) return { ok: false, reason: "gender_mismatch" };

  await conn.execute(sql`
    update tasks
    set
      status = 'pending'::task_status,
      attempts = 0,
      leased_by = null,
      leased_at = null,
      last_error = null,
      run_after = now(),
      updated_at = now()
    where id = ${String(row.task_id)}
  `);
  await conn.execute(sql`
    update applications
    set
      status = 'draft'::application_status,
      reason = 'retry queued',
      updated_at = now()
    where id = ${applicationId}
      and user_id = ${userId}
  `);
  await conn.execute(sql`
    update matches
    set status = 'queued'::match_status, updated_at = now()
    where id = ${String(row.match_id)}
      and user_id = ${userId}
  `);

  return { ok: true, taskId: String(row.task_id) };
}
