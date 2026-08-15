import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";

export type InterviewPrepDb = typeof defaultDb;

export type InterviewPrepStatus =
  | "queued"
  | "applying"
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
  submitted: number;
  failed: number;
  skipped: number;
  dead: number;
}

export interface InterviewPrepData {
  summary: InterviewPrepSummary;
  rows: InterviewPrepRow[];
  updatedAt: string;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusFor(row: Record<string, unknown>): InterviewPrepStatus {
  const appStatus = row.application_status as string | null;
  const taskStatus = row.task_status as string | null;
  if (appStatus === "submitted") return "submitted";
  if (appStatus === "failed") return "failed";
  if (appStatus === "skipped") return "skipped";
  if (taskStatus === "pending") return "queued";
  if (taskStatus === "leased") return "applying";
  if (taskStatus === "dead") return "dead";
  if (appStatus === "draft") return "draft";
  return "draft";
}

export async function getInterviewPrepData(
  userId: string,
  opts: { limit?: number; db?: InterviewPrepDb } = {},
): Promise<InterviewPrepData> {
  const conn = opts.db ?? defaultDb;
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 2000));

  const rows = await conn.execute(sql`
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
      exists (
        select 1
        from resumes r
        where r.user_id = ${userId}
          and r.listing_id = l.id
          and r.is_base = false
      ) as has_resume,
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
    order by coalesce(a.updated_at, t.updated_at, m.updated_at, m.created_at) desc
    limit ${limit}
  `);

  const mapped: InterviewPrepRow[] = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    applicationId: r.application_id ? String(r.application_id) : null,
    taskId: r.task_id ? String(r.task_id) : null,
    matchId: String(r.match_id),
    listingId: String(r.listing_id),
    status: statusFor(r),
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

  const summary: InterviewPrepSummary = {
    total: mapped.length,
    queued: mapped.filter((r) => r.status === "queued").length,
    applying: mapped.filter((r) => r.status === "applying").length,
    submitted: mapped.filter((r) => r.status === "submitted").length,
    failed: mapped.filter((r) => r.status === "failed").length,
    skipped: mapped.filter((r) => r.status === "skipped").length,
    dead: mapped.filter((r) => r.status === "dead").length,
  };

  return { summary, rows: mapped, updatedAt: new Date().toISOString() };
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
  if (row.application_status !== "failed") return { ok: false, reason: "not_failed" };
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
