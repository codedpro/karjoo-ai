import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import {
  applications,
  auditEvents,
  boardApplications,
  jobListings,
  tasks,
} from "@/db/schema";

export interface JobinjaHistoryEvidence {
  url?: string | null;
  appliedAt?: Date | null;
}

export interface JobinjaReconciliationOptions {
  completeWindow: boolean;
  windowStart: Date;
  checkedAt?: Date;
  db?: Database;
}

export interface JobinjaReconciliationResult {
  confirmed: number;
  retryable: number;
  unresolved: number;
}

export type JobinjaVerificationDecision =
  | { action: "confirmed"; jobId: string; evidence: JobinjaHistoryEvidence }
  | { action: "retryable"; jobId: string | null }
  | { action: "unresolved"; jobId: string | null };

/** Jobinja application IDs and job IDs differ; only the `/jobs/{id}` URL segment is stable. */
export function jobinjaJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://jobinja.ir");
    if (!/(^|\.)jobinja\.ir$/i.test(parsed.hostname)) return null;
    const match = /\/jobs\/([A-Za-z0-9]+)/.exec(parsed.pathname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function attemptTime(row: { createdAt: Date; updatedAt: Date; reason: string | null }): Date {
  return row.reason?.includes("corrected historical") ? row.createdAt : row.updatedAt;
}

export function classifyJobinjaVerification(input: {
  listingUrl: string;
  createdAt: Date;
  updatedAt: Date;
  reason: string | null;
  history: readonly JobinjaHistoryEvidence[];
  completeWindow: boolean;
  windowStart: Date;
}): JobinjaVerificationDecision {
  const jobId = jobinjaJobId(input.listingUrl);
  const evidence = jobId
    ? input.history.find((item) => jobinjaJobId(item.url) === jobId)
    : undefined;
  if (jobId && evidence) return { action: "confirmed", jobId, evidence };
  if (input.completeWindow && attemptTime(input) >= input.windowStart) {
    return { action: "retryable", jobId };
  }
  return { action: "unresolved", jobId };
}

export async function reconcileJobinjaVerifying(
  userId: string,
  history: readonly JobinjaHistoryEvidence[],
  options: JobinjaReconciliationOptions,
): Promise<JobinjaReconciliationResult> {
  const conn = options.db ?? defaultDb;
  const checkedAt = options.checkedAt ?? new Date();
  const rows = await conn
    .select({
      applicationId: applications.id,
      matchId: applications.matchId,
      listingUrl: jobListings.url,
      createdAt: applications.createdAt,
      updatedAt: applications.updatedAt,
      reason: applications.reason,
    })
    .from(applications)
    .innerJoin(jobListings, eq(applications.listingId, jobListings.id))
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.status, "verifying"),
        eq(jobListings.board, "jobinja"),
      ),
    );

  let confirmed = 0;
  let retryable = 0;
  let unresolved = 0;

  for (const row of rows) {
    const decision = classifyJobinjaVerification({
      ...row,
      history,
      completeWindow: options.completeWindow,
      windowStart: options.windowStart,
    });
    if (decision.action === "confirmed") {
      const { jobId, evidence } = decision;
      const proof = {
        provider: "jobinja",
        signal: "application_history",
        jobId,
        checkedAt: checkedAt.toISOString(),
      };
      await conn
        .update(applications)
        .set({
          status: "submitted",
          reason: null,
          proof,
          submittedAt: evidence.appliedAt ?? checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(applications.id, row.applicationId));
      await conn
        .update(tasks)
        .set({ status: "succeeded", lastError: null, leasedAt: null, updatedAt: checkedAt })
        .where(eq(tasks.matchId, row.matchId));
      await conn.insert(auditEvents).values({
        userId,
        applicationId: row.applicationId,
        eventType: "apply_submitted",
        metadata: { source: "jobinja_history_reconciliation", jobId },
      });
      confirmed += 1;
      continue;
    }

    if (decision.action === "unresolved") {
      unresolved += 1;
      continue;
    }

    const { jobId } = decision;
    const reason = "jobinja_history_checked_not_found";
    const proof = {
      provider: "jobinja",
      signal: "history_not_found",
      ...(jobId ? { jobId } : {}),
      checkedAt: checkedAt.toISOString(),
      windowStart: options.windowStart.toISOString(),
    };
    await conn
      .update(applications)
      .set({ status: "failed", reason, proof, submittedAt: null, updatedAt: checkedAt })
      .where(eq(applications.id, row.applicationId));
    await conn
      .insert(tasks)
      .values({
        idempotencyKey: `apply:${row.matchId}`,
        matchId: row.matchId,
        payload: { board: "jobinja", url: row.listingUrl, mode: "manual" },
        status: "pending",
        runAfter: checkedAt,
        lastError: reason,
        updatedAt: checkedAt,
      })
      .onConflictDoUpdate({
        target: tasks.idempotencyKey,
        set: {
          status: "pending",
          leasedBy: null,
          leasedAt: null,
          runAfter: checkedAt,
          lastError: reason,
          updatedAt: checkedAt,
        },
      });
    await conn.insert(auditEvents).values({
      userId,
      applicationId: row.applicationId,
      eventType: "apply_failed",
      metadata: { source: "jobinja_history_reconciliation", ...(jobId ? { jobId } : {}) },
    });
    retryable += 1;
  }

  return { confirmed, retryable, unresolved };
}

export async function reconcileJobinjaFromStoredHistory(
  userId: string,
  conn: Database = defaultDb,
): Promise<JobinjaReconciliationResult> {
  const history = await conn
    .select({ url: boardApplications.url, appliedAt: boardApplications.appliedAt })
    .from(boardApplications)
    .where(and(eq(boardApplications.userId, userId), eq(boardApplications.board, "jobinja")));

  return reconcileJobinjaVerifying(userId, history, {
    completeWindow: false,
    windowStart: new Date(0),
    db: conn,
  });
}

export async function markJobinjaUnconfirmedForVerification(
  userId: string,
  conn: Database = defaultDb,
): Promise<number> {
  const changed = await conn
    .update(applications)
    .set({ status: "verifying", submittedAt: null })
    .from(jobListings)
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.listingId, jobListings.id),
        eq(jobListings.board, "jobinja"),
        sql`${applications.reason} like 'jobinja_submission_unconfirmed%'`,
      ),
    )
    .returning({ matchId: applications.matchId });

  for (const row of changed) {
    await conn
      .update(tasks)
      .set({ status: "verifying", leasedBy: null, leasedAt: null, updatedAt: new Date() })
      .where(eq(tasks.matchId, row.matchId));
  }
  return changed.length;
}
