import "server-only";

import { and, eq, exists, inArray, not, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import { jobListings, matches, resumes, tasks } from "@/db/schema";
import { generateTailoredResume } from "@/lib/resume/custom-resume-service";
import { logger } from "@/lib/observability/logger";
import type { ActiveApplyBoard } from "@/lib/apply/filters";

export interface QueueResumePrepResult {
  attempted: number;
  prepared: number;
  failed: number;
}

export const DEFAULT_QUEUE_RESUME_PREP_LIMIT = 20;
export const MAX_QUEUE_RESUME_PREP_LIMIT = 25;
const QUEUE_RESUME_PREP_CONCURRENCY = 5;

export type NextQueueResumeResult =
  | { status: "empty" }
  | { status: "ready"; taskId: string; listingId: string; generated: boolean }
  | { status: "failed"; taskId: string; listingId: string; code?: string };

export async function prepareNextTailoredResumeForQueue(
  userId: string,
  opts: { db?: Database; allowedBoards?: readonly ActiveApplyBoard[] } = {},
): Promise<NextQueueResumeResult> {
  const conn = opts.db ?? defaultDb;
  const boards = (["jobinja", "e-estekhdam", "irantalent"] as const).filter(
    (board) => !opts.allowedBoards || opts.allowedBoards.includes(board),
  );
  if (boards.length === 0) return { status: "empty" };
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
  const [row] = await conn
    .select({
      taskId: tasks.id,
      listingId: jobListings.id,
      title: jobListings.title,
      board: jobListings.board,
      matchId: matches.id,
      coverLetter: matches.coverLetter,
      hasTailoredResume,
    })
    .from(tasks)
    .innerJoin(matches, eq(matches.id, tasks.matchId))
    .innerJoin(jobListings, eq(jobListings.id, matches.listingId))
    .where(
      and(
        eq(matches.userId, userId),
        inArray(jobListings.board, boards),
        eq(tasks.status, "pending"),
        sql`${tasks.runAfter} <= now()`,
      ),
    )
    .orderBy(sql`${jobListings.postedAt} DESC NULLS LAST`, tasks.createdAt)
    .limit(1);

  if (!row) return { status: "empty" };
  if (row.hasTailoredResume && (row.board !== "e-estekhdam" || row.coverLetter?.trim())) {
    return { status: "ready", taskId: row.taskId, listingId: row.listingId, generated: false };
  }

  try {
    const generated = await generateTailoredResume(userId, row.listingId, {
      db: conn,
      source: "auto_apply",
    });
    if (row.board === "e-estekhdam") {
      await conn
        .update(matches)
        .set({ coverLetter: coverLetterFromResume(generated), updatedAt: sql`now()` })
        .where(eq(matches.id, row.matchId));
    }
    await conn
      .update(tasks)
      .set({ lastError: null, updatedAt: sql`now()` })
      .where(eq(tasks.id, row.taskId));
    return { status: "ready", taskId: row.taskId, listingId: row.listingId, generated: true };
  } catch (err) {
    logger.warn("next queue resume preparation failed", {
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
        lastError: "tailored_resume_generation_failed",
        runAfter: sql`now() + interval '30 minutes'`,
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, row.taskId));
    // Carry the cause out. "generation failed" alone cannot distinguish one odd
    // listing from the whole platform's AI budget being spent — and those need
    // opposite responses: skip the listing, or tell the user to act.
    const code = (err as { code?: unknown })?.code;
    return {
      status: "failed",
      taskId: row.taskId,
      listingId: row.listingId,
      ...(typeof code === "string" ? { code } : {}),
    };
  }
}

export async function prepareTailoredResumesForQueue(
  userId: string,
  opts: { limit?: number; db?: Database; allowedBoards?: readonly ActiveApplyBoard[] } = {},
): Promise<QueueResumePrepResult> {
  const conn = opts.db ?? defaultDb;
  const limit = Math.max(
    0,
    Math.min(Math.floor(opts.limit ?? DEFAULT_QUEUE_RESUME_PREP_LIMIT), MAX_QUEUE_RESUME_PREP_LIMIT),
  );
  if (limit === 0) return { attempted: 0, prepared: 0, failed: 0 };
  const boards = (["jobinja", "e-estekhdam", "irantalent"] as const).filter(
    (board) => !opts.allowedBoards || opts.allowedBoards.includes(board),
  );
  if (boards.length === 0) return { attempted: 0, prepared: 0, failed: 0 };

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
      board: jobListings.board,
      matchId: matches.id,
    })
    .from(tasks)
    .innerJoin(matches, eq(matches.id, tasks.matchId))
    .innerJoin(jobListings, eq(jobListings.id, matches.listingId))
    .where(
      and(
        eq(matches.userId, userId),
        inArray(jobListings.board, boards),
        eq(tasks.status, "pending"),
        sql`${tasks.runAfter} <= now()`,
        not(hasTailoredResume),
      ),
    )
    .orderBy(tasks.runAfter, tasks.createdAt)
    .limit(limit);

  async function prepareOne(row: (typeof rows)[number]): Promise<"prepared" | "failed"> {
    try {
      const generated = await generateTailoredResume(userId, row.listingId, {
        db: conn,
        source: "auto_apply",
      });
      if (row.board === "e-estekhdam") {
        await conn
          .update(matches)
          .set({ coverLetter: coverLetterFromResume(generated), updatedAt: sql`now()` })
          .where(eq(matches.id, row.matchId));
      }
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

function coverLetterFromResume(result: {
  fullName: string;
  headline: string;
  summary: string;
  jobTitle: string | null;
}): string {
  const summary = result.summary.trim().slice(0, 1_400);
  const isPersian = /[\u0600-\u06ff]/.test(`${summary} ${result.jobTitle ?? ""}`);
  if (isPersian) {
    return [
      "سلام،",
      summary,
      "رزومه پیوست شده است و خوشحال می‌شوم درباره تجربه و توانایی‌هایم بیشتر گفتگو کنیم.",
      `با احترام،\n${result.fullName}`,
    ].join("\n\n");
  }
  return [
    "Hello,",
    summary,
    "My resume is attached, and I would welcome the opportunity to discuss my experience and capabilities.",
    `Kind regards,\n${result.fullName}`,
  ].join("\n\n");
}
