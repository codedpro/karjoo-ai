import "server-only";

import { and, eq, exists, not, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import { jobListings, matches, resumes, tasks } from "@/db/schema";
import { generateTailoredResume } from "@/lib/resume/custom-resume-service";
import { logger } from "@/lib/observability/logger";

export interface QueueResumePrepResult {
  attempted: number;
  prepared: number;
  failed: number;
}

export const DEFAULT_QUEUE_RESUME_PREP_LIMIT = 20;
export const MAX_QUEUE_RESUME_PREP_LIMIT = 25;
const QUEUE_RESUME_PREP_CONCURRENCY = 5;

export async function prepareTailoredResumesForQueue(
  userId: string,
  opts: { limit?: number; db?: Database } = {},
): Promise<QueueResumePrepResult> {
  const conn = opts.db ?? defaultDb;
  const limit = Math.max(
    0,
    Math.min(Math.floor(opts.limit ?? DEFAULT_QUEUE_RESUME_PREP_LIMIT), MAX_QUEUE_RESUME_PREP_LIMIT),
  );
  if (limit === 0) return { attempted: 0, prepared: 0, failed: 0 };

  const hasTailoredResume = exists(
    conn
      .select({ one: sql`1` })
      .from(resumes)
      .where(
        and(
          eq(resumes.userId, userId),
          eq(resumes.listingId, jobListings.id),
          eq(resumes.isBase, false),
        ),
      ),
  );

  const rows = await conn
    .select({
      taskId: tasks.id,
      listingId: jobListings.id,
      title: jobListings.title,
    })
    .from(tasks)
    .innerJoin(matches, eq(matches.id, tasks.matchId))
    .innerJoin(jobListings, eq(jobListings.id, matches.listingId))
    .where(
      and(
        eq(matches.userId, userId),
        eq(tasks.status, "pending"),
        sql`${tasks.runAfter} <= now()`,
        not(hasTailoredResume),
      ),
    )
    .orderBy(tasks.runAfter, tasks.createdAt)
    .limit(limit);

  async function prepareOne(row: (typeof rows)[number]): Promise<"prepared" | "failed"> {
    try {
      await generateTailoredResume(userId, row.listingId, {
        db: conn,
        source: "auto_apply",
      });
      await conn
        .update(tasks)
        .set({ lastError: null, updatedAt: sql`now()` })
        .where(eq(tasks.id, row.taskId));
      return "prepared";
    } catch (err) {
      logger.warn("queue resume preparation failed", {
        path: "resume/queue-prep",
        userId,
        taskId: row.taskId,
        listingId: row.listingId,
        title: row.title,
        err: err instanceof Error ? err : new Error(String(err)),
      });
      await conn
        .update(tasks)
        .set({
          lastError: "tailored_resume_prepare_failed",
          runAfter: sql`now() + interval '30 minutes'`,
          updatedAt: sql`now()`,
        })
        .where(eq(tasks.id, row.taskId));
      return "failed";
    }
  }

  let prepared = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += QUEUE_RESUME_PREP_CONCURRENCY) {
    const batch = rows.slice(i, i + QUEUE_RESUME_PREP_CONCURRENCY);
    const results = await Promise.all(batch.map((row) => prepareOne(row)));
    prepared += results.filter((status) => status === "prepared").length;
    failed += results.filter((status) => status === "failed").length;
  }

  return { attempted: rows.length, prepared, failed };
}
