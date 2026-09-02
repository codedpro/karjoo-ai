import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { readExecutionRun, type ExecutionRunView } from "@/lib/apply/execution-run";

export type LiveTaskStatus = "pending" | "leased";
export type LiveApplicationStatus = "draft" | "submitted" | "skipped" | "failed";

export interface LiveApplyCounts {
  queued: number;
  applying: number;
  appliedToday: number;
  appliedTotal: number;
  appliedLast30d: number;
  reviewNeeded: number;
}

export interface LiveApplyJob {
  taskId: string;
  matchId: string;
  status: LiveTaskStatus;
  attempts: number;
  runAfter: string;
  leasedAt: string | null;
  createdAt: string;
  lastError: string | null;
  matchScore: number | null;
  hasTailoredResume: boolean;
  resumeStrategy: "tailored_pdf" | "native_profile_resume";
  listing: {
    board: string;
    title: string;
    company: string | null;
    city: string | null;
    url: string;
    postedAt: string | null;
    description: string | null;
  };
}

export interface LiveApplyResult {
  applicationId: string;
  status: LiveApplicationStatus;
  channel: "extension" | "worker" | null;
  matchScore: number | null;
  happenedAt: string;
  hasResume: boolean;
  resumeStrategy: "tailored_pdf" | "native_profile_resume";
  resumeId: string | null;
  retryEligible: boolean;
  reason: string | null;
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

export interface LiveApplyOverview {
  execution: ExecutionRunView;
  counts: LiveApplyCounts;
  applying: LiveApplyJob[];
  queue: LiveApplyJob[];
  recent: LiveApplyResult[];
  updatedAt: string;
}

type LiveDb = typeof defaultDb;

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resumeStrategyForBoard(board: unknown): "tailored_pdf" | "native_profile_resume" {
  return board === "jobvision" || board === "irantalent" ? "native_profile_resume" : "tailored_pdf";
}

export async function getLiveApplyOverview(
  userId: string,
  opts: { queueLimit?: number; recentLimit?: number; db?: LiveDb } = {},
): Promise<LiveApplyOverview> {
  const conn = opts.db ?? defaultDb;
  const queueLimit = Math.max(1, Math.min(opts.queueLimit ?? 40, 100));
  const recentLimit = Math.max(1, Math.min(opts.recentLimit ?? 30, 100));

  const [countRows, taskRows, recentRows, execution] = await Promise.all([
    conn.execute(sql`
      select
        count(*) filter (where t.status in ('pending', 'leased'))::int as queued,
        count(*) filter (where t.status = 'leased')::int as applying,
        (
          select count(*)::int
          from applications a
          where a.user_id = ${userId}
            and a.status = 'submitted'
            and coalesce(a.submitted_at, a.created_at) >= date_trunc('day', now())
        ) as applied_today,
        (
          select count(*)::int
          from applications a
          where a.user_id = ${userId}
            and a.status = 'submitted'
        ) as applied_total,
        (
          select count(*)::int
          from applications a
          where a.user_id = ${userId}
            and a.status = 'submitted'
            and coalesce(a.submitted_at, a.created_at) >= now() - interval '30 days'
        ) as applied_last_30d
        ,(
          select count(*)::int
          from applications a
          where a.user_id = ${userId}
            and a.status in ('failed', 'skipped')
        ) as review_needed
      from tasks t
      inner join matches m on m.id = t.match_id
      where m.user_id = ${userId}
    `),
    conn.execute(sql`
      select
        t.id as task_id,
        t.status,
        t.attempts,
        t.run_after,
        t.leased_at,
        t.created_at,
        t.last_error,
        m.id as match_id,
        m.score as match_score,
        exists (
          select 1 from resumes r
          where r.user_id = ${userId}
            and r.listing_id = l.id
            and r.is_base = false
        ) as has_tailored_resume,
        l.board,
        l.title,
        l.company,
        l.city,
        l.url,
        l.posted_at,
        l.description
      from tasks t
      inner join matches m on m.id = t.match_id
      inner join job_listings l on l.id = m.listing_id
      where m.user_id = ${userId}
        and t.status in ('pending', 'leased')
      order by
        case when t.status = 'leased' then 0 else 1 end,
        l.posted_at desc nulls last,
        t.created_at asc
      limit ${queueLimit}
    `),
    conn.execute(sql`
      select
        a.id as application_id,
        a.status,
        a.channel,
        a.match_score,
        a.reason,
        a.resume_id is not null as has_resume,
        a.resume_id,
        coalesce(a.submitted_at, a.created_at) as happened_at,
        l.board,
        l.title,
        l.company,
        l.city,
        l.url,
        l.description,
        l.posted_at
      from applications a
      inner join job_listings l on l.id = a.listing_id
      where a.user_id = ${userId}
      order by coalesce(a.submitted_at, a.created_at) desc
      limit ${recentLimit}
    `),
    readExecutionRun(userId, conn),
  ]);

  const countsRaw = (countRows as unknown as Record<string, unknown>[])[0] ?? {};
  const allTasks: LiveApplyJob[] = (taskRows as unknown as Record<string, unknown>[])
    .map((r) => ({
      taskId: String(r.task_id),
      matchId: String(r.match_id),
      status: r.status as LiveTaskStatus,
      attempts: Number(r.attempts ?? 0),
      runAfter: iso(r.run_after) ?? new Date().toISOString(),
      leasedAt: iso(r.leased_at),
      createdAt: iso(r.created_at) ?? new Date().toISOString(),
      lastError: (r.last_error as string | null) ?? null,
      matchScore: typeof r.match_score === "number" ? r.match_score : null,
      hasTailoredResume: r.has_tailored_resume === true,
      resumeStrategy: resumeStrategyForBoard(r.board),
      listing: {
        board: String(r.board),
        title: String(r.title),
        company: (r.company as string | null) ?? null,
        city: (r.city as string | null) ?? null,
        url: String(r.url),
        postedAt: iso(r.posted_at),
        description: (r.description as string | null) ?? null,
      },
    }));

  const recent: LiveApplyResult[] = (recentRows as unknown as Record<string, unknown>[])
    .map((r) => ({
      applicationId: String(r.application_id),
      status: r.status as LiveApplicationStatus,
      channel: (r.channel as "extension" | "worker" | null) ?? null,
      matchScore: typeof r.match_score === "number" ? r.match_score : null,
      happenedAt: iso(r.happened_at) ?? new Date().toISOString(),
      hasResume: r.has_resume === true,
      resumeStrategy: resumeStrategyForBoard(r.board),
      resumeId: r.resume_id ? String(r.resume_id) : null,
      retryEligible: r.status === "failed",
      reason: (r.reason as string | null) ?? null,
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
    execution,
    counts: {
      queued: Number(countsRaw.queued ?? 0),
      applying: Number(countsRaw.applying ?? 0),
      appliedToday: Number(countsRaw.applied_today ?? 0),
      appliedTotal: Number(countsRaw.applied_total ?? 0),
      appliedLast30d: Number(countsRaw.applied_last_30d ?? 0),
      reviewNeeded: Number(countsRaw.review_needed ?? 0),
    },
    applying: allTasks.filter((t) => t.status === "leased"),
    queue: allTasks.filter((t) => t.status === "pending"),
    recent,
    updatedAt: new Date().toISOString(),
  };
}
