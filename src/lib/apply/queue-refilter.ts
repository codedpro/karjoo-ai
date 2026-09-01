import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import { jobListings, matches, tasks } from "@/db/schema";
import type { ActiveApplyBoard } from "@/lib/apply/filters";

export interface QueueRefilterResult {
  removed: number;
  boards: ActiveApplyBoard[];
}

export function stalePendingQueueCondition(
  userId: string,
  boards: readonly ActiveApplyBoard[],
) {
  return and(
    eq(matches.userId, userId),
    eq(tasks.status, "pending"),
    inArray(jobListings.board, [...boards]),
    sql`coalesce(${tasks.payload} ->> 'mode', 'filter') <> 'manual'`,
  );
}

/**
 * Remove stale automatic jobs after targeting changes. Completed/history rows,
 * manual tasks, and a task already leased for submission are intentionally kept.
 */
export async function invalidatePendingQueueForFilters(
  userId: string,
  boards: readonly ActiveApplyBoard[],
  conn: Database = defaultDb,
): Promise<QueueRefilterResult> {
  if (boards.length === 0) return { removed: 0, boards: [] };

  return conn.transaction(async (tx) => {
    const stale = await tx
      .select({ taskId: tasks.id, matchId: tasks.matchId })
      .from(tasks)
      .innerJoin(matches, eq(tasks.matchId, matches.id))
      .innerJoin(jobListings, eq(matches.listingId, jobListings.id))
      .where(stalePendingQueueCondition(userId, boards));

    if (stale.length === 0) return { removed: 0, boards: [...boards] };
    const taskIds = stale.map((row) => row.taskId);
    const matchIds = [...new Set(stale.map((row) => row.matchId))];

    await tx.delete(tasks).where(inArray(tasks.id, taskIds));
    await tx
      .update(matches)
      .set({ status: "scored", updatedAt: sql`now()` })
      .where(and(inArray(matches.id, matchIds), eq(matches.status, "queued")));

    return { removed: stale.length, boards: [...boards] };
  });
}
