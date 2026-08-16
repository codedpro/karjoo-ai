import "server-only";

import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { applyExecutionRuns, matches, tasks } from "@/db/schema";

export type ExecutionOwner = "extension" | "server";
export type ExecutionState = "paused" | "running" | "blocked" | "completed";

export interface ExecutionProgress {
  stage?: string;
  title?: string;
  company?: string;
  message?: string;
  discovered?: number;
  submitted?: number;
  failed?: number;
  [key: string]: unknown;
}

export interface ExecutionRunView {
  state: ExecutionState;
  owner: ExecutionOwner | null;
  executorId: string | null;
  board: string | null;
  currentTaskId: string | null;
  progress: ExecutionProgress;
  blockedReason: string | null;
  backgroundEnabled: boolean;
  heartbeatAt: string | null;
  startedAt: string | null;
  blockedAt: string | null;
  updatedAt: string | null;
}

type RunDb = typeof defaultDb;

export class ExecutionOwnershipError extends Error {
  constructor(
    message: string,
    readonly code: "owned_by_server" | "owned_by_other_extension" | "not_running",
  ) {
    super(message);
    this.name = "ExecutionOwnershipError";
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function viewOf(row: typeof applyExecutionRuns.$inferSelect | undefined): ExecutionRunView {
  if (!row) {
    return {
      state: "paused",
      owner: null,
      executorId: null,
      board: null,
      currentTaskId: null,
      progress: {},
      blockedReason: null,
      backgroundEnabled: true,
      heartbeatAt: null,
      startedAt: null,
      blockedAt: null,
      updatedAt: null,
    };
  }
  return {
    state: row.state as ExecutionState,
    owner: row.owner as ExecutionOwner | null,
    executorId: row.executorId,
    board: row.board,
    currentTaskId: row.currentTaskId,
    progress: (row.progress ?? {}) as ExecutionProgress,
    blockedReason: row.blockedReason,
    backgroundEnabled: row.backgroundEnabled,
    heartbeatAt: iso(row.heartbeatAt),
    startedAt: iso(row.startedAt),
    blockedAt: iso(row.blockedAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function readExecutionRun(
  userId: string,
  conn: RunDb = defaultDb,
): Promise<ExecutionRunView> {
  const row = await conn.query.applyExecutionRuns.findFirst({
    where: eq(applyExecutionRuns.userId, userId),
  });
  return viewOf(row);
}

/** Assign the queue to one browser. Explicit takeover may replace any server-owned run. */
export async function startExtensionExecution(
  userId: string,
  executorId: string,
  opts: { takeover?: boolean; backgroundEnabled?: boolean; db?: RunDb } = {},
): Promise<ExecutionRunView> {
  const conn = opts.db ?? defaultDb;
  const current = await readExecutionRun(userId, conn);
  if (current.owner === "server" && current.state === "running" && !opts.takeover) {
    throw new ExecutionOwnershipError(
      "server execution is active; use explicit extension takeover",
      "owned_by_server",
    );
  }
  if (
    current.owner === "extension" &&
    current.executorId !== executorId &&
    current.state === "running"
  ) {
    throw new ExecutionOwnershipError(
      "another browser owns this run",
      "owned_by_other_extension",
    );
  }
  const now = new Date();
  const [row] = await conn
    .insert(applyExecutionRuns)
    .values({
      userId,
      state: "running",
      owner: "extension",
      executorId,
      board: "jobinja",
      progress: { stage: "starting" },
      backgroundEnabled: opts.backgroundEnabled ?? true,
      heartbeatAt: now,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: applyExecutionRuns.userId,
      setWhere: opts.takeover
        ? or(
            eq(applyExecutionRuns.owner, "server"),
            and(eq(applyExecutionRuns.owner, "extension"), eq(applyExecutionRuns.executorId, executorId)),
          )
        : or(
            isNull(applyExecutionRuns.owner),
            and(eq(applyExecutionRuns.owner, "extension"), eq(applyExecutionRuns.executorId, executorId)),
            eq(applyExecutionRuns.state, "paused"),
            eq(applyExecutionRuns.state, "completed"),
          ),
      set: {
        state: "running",
        owner: "extension",
        executorId,
        board: "jobinja",
        currentTaskId: null,
        progress: { stage: "starting" },
        blockedReason: null,
        blockedAt: null,
        backgroundEnabled: opts.backgroundEnabled ?? current.backgroundEnabled,
        heartbeatAt: now,
        startedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new ExecutionOwnershipError(
      "queue ownership changed; refresh and try again",
      current.owner === "server" ? "owned_by_server" : "owned_by_other_extension",
    );
  }

  if (opts.takeover) await releaseServerLeasesForUser(userId, conn);
  await releaseStaleExtensionLeases(userId, conn);
  return viewOf(row);
}

export async function pauseExtensionExecution(
  userId: string,
  executorId: string,
  opts: { stop?: boolean; db?: RunDb } = {},
): Promise<ExecutionRunView> {
  const conn = opts.db ?? defaultDb;
  const [row] = await conn
    .update(applyExecutionRuns)
    .set({
      state: "paused",
      ...(opts.stop ? { owner: null, executorId: null } : {}),
      currentTaskId: null,
      progress: { stage: opts.stop ? "stopped" : "paused" },
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(applyExecutionRuns.userId, userId),
        eq(applyExecutionRuns.owner, "extension"),
        eq(applyExecutionRuns.executorId, executorId),
      ),
    )
    .returning();
  if (!row) {
    throw new ExecutionOwnershipError("this browser does not own the run", "owned_by_other_extension");
  }
  await releaseExtensionLeasesForUser(userId, conn);
  return viewOf(row);
}

export async function heartbeatExtensionExecution(
  userId: string,
  executorId: string,
  opts: { backgroundEnabled?: boolean; db?: RunDb } = {},
): Promise<ExecutionRunView> {
  const conn = opts.db ?? defaultDb;
  const [row] = await conn
    .update(applyExecutionRuns)
    .set({
      heartbeatAt: new Date(),
      updatedAt: new Date(),
      ...(opts.backgroundEnabled === undefined
        ? {}
        : { backgroundEnabled: opts.backgroundEnabled }),
    })
    .where(
      and(
        eq(applyExecutionRuns.userId, userId),
        eq(applyExecutionRuns.owner, "extension"),
        eq(applyExecutionRuns.executorId, executorId),
      ),
    )
    .returning();
  if (!row) {
    throw new ExecutionOwnershipError("this browser does not own the run", "owned_by_other_extension");
  }
  return viewOf(row);
}

export async function updateExtensionProgress(
  userId: string,
  executorId: string,
  input: { currentTaskId?: string | null; progress: ExecutionProgress; db?: RunDb },
): Promise<ExecutionRunView> {
  const conn = input.db ?? defaultDb;
  const [row] = await conn
    .update(applyExecutionRuns)
    .set({
      currentTaskId: input.currentTaskId ?? null,
      progress: input.progress,
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(applyExecutionRuns.userId, userId),
        eq(applyExecutionRuns.owner, "extension"),
        eq(applyExecutionRuns.executorId, executorId),
        eq(applyExecutionRuns.state, "running"),
      ),
    )
    .returning();
  if (!row) throw new ExecutionOwnershipError("extension run is not active", "not_running");
  return viewOf(row);
}

export async function completeExtensionExecution(
  userId: string,
  executorId: string,
  conn: RunDb = defaultDb,
): Promise<void> {
  await conn
    .update(applyExecutionRuns)
    .set({
      state: "completed",
      currentTaskId: null,
      progress: { stage: "completed" },
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(applyExecutionRuns.userId, userId),
        eq(applyExecutionRuns.owner, "extension"),
        eq(applyExecutionRuns.executorId, executorId),
      ),
    );
}

export async function assertExtensionExecutionOwner(
  userId: string,
  executorId: string,
  conn: RunDb = defaultDb,
): Promise<void> {
  const run = await readExecutionRun(userId, conn);
  if (run.owner !== "extension" || run.executorId !== executorId) {
    throw new ExecutionOwnershipError("queue is owned by another executor", "owned_by_other_extension");
  }
  if (run.state !== "running") {
    throw new ExecutionOwnershipError("extension run is not active", "not_running");
  }
}

/** Security challenge in the user's browser: preserve the task and stop the run. */
export async function blockExtensionExecution(
  userId: string,
  executorId: string,
  taskId: string | undefined,
  reason: string,
  conn: RunDb = defaultDb,
): Promise<ExecutionRunView> {
  await assertExtensionExecutionOwner(userId, executorId, conn);
  if (taskId) await releaseTaskForUser(userId, taskId, conn, null);
  const now = new Date();
  const [row] = await conn
    .update(applyExecutionRuns)
    .set({
      state: "blocked",
      board: "jobinja",
      currentTaskId: null,
      progress: { stage: "blocked", message: reason },
      blockedReason: reason,
      blockedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    })
    .where(and(eq(applyExecutionRuns.userId, userId), eq(applyExecutionRuns.executorId, executorId)))
    .returning();
  return viewOf(row);
}

/** Security challenge on a fleet node: requeue its task and expose one-click takeover. */
export async function blockServerExecution(
  userId: string,
  nodeId: string,
  taskId: string,
  reason: string,
  conn: RunDb = defaultDb,
): Promise<ExecutionRunView | null> {
  const released = await releaseTaskForUser(userId, taskId, conn, nodeId);
  if (!released) return null;
  await releaseServerLeasesForUser(userId, conn, nodeId);
  const now = new Date();
  const [row] = await conn
    .insert(applyExecutionRuns)
    .values({
      userId,
      state: "blocked",
      owner: "server",
      executorId: nodeId,
      board: "jobinja",
      progress: { stage: "blocked", message: reason },
      blockedReason: reason,
      blockedAt: now,
      heartbeatAt: now,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: applyExecutionRuns.userId,
      setWhere: or(isNull(applyExecutionRuns.owner), eq(applyExecutionRuns.owner, "server")),
      set: {
        state: "blocked",
        owner: "server",
        executorId: nodeId,
        board: "jobinja",
        currentTaskId: null,
        progress: { stage: "blocked", message: reason },
        blockedReason: reason,
        blockedAt: now,
        heartbeatAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row ? viewOf(row) : null;
}

/** Server may claim only when no extension owns the account and it is not blocked. */
export async function canServerExecute(
  userId: string,
  conn: RunDb = defaultDb,
): Promise<boolean> {
  const run = await readExecutionRun(userId, conn);
  if (run.state === "blocked") return false;
  return run.owner === null || run.owner === "server";
}

export async function markServerExecutionRunning(
  userId: string,
  nodeId: string,
  conn: RunDb = defaultDb,
): Promise<boolean> {
  if (!(await canServerExecute(userId, conn))) return false;
  const now = new Date();
  const [row] = await conn
    .insert(applyExecutionRuns)
    .values({
      userId,
      state: "running",
      owner: "server",
      executorId: nodeId,
      board: "jobinja",
      progress: { stage: "claiming" },
      heartbeatAt: now,
      startedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: applyExecutionRuns.userId,
      setWhere: and(
        or(isNull(applyExecutionRuns.owner), eq(applyExecutionRuns.owner, "server")),
        sql`${applyExecutionRuns.state} <> 'blocked'`,
      ),
      set: {
        state: "running",
        owner: "server",
        executorId: nodeId,
        board: "jobinja",
        progress: { stage: "claiming" },
        heartbeatAt: now,
        startedAt: sql`coalesce(${applyExecutionRuns.startedAt}, now())`,
        updatedAt: now,
      },
    })
    .returning({ userId: applyExecutionRuns.userId });
  return Boolean(row);
}

async function releaseTaskForUser(
  userId: string,
  taskId: string,
  conn: RunDb,
  leasedBy: string | null,
): Promise<boolean> {
  const [owned] = await conn
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .where(
      and(
        eq(tasks.id, taskId),
        eq(matches.userId, userId),
        eq(tasks.status, "leased"),
        leasedBy === null ? isNull(tasks.leasedBy) : eq(tasks.leasedBy, leasedBy),
      ),
    )
    .limit(1);
  if (!owned) return false;
  await conn
    .update(tasks)
    .set({
      status: "pending",
      leasedAt: null,
      leasedBy: null,
      lastError: reasonForRequeue(leasedBy),
      runAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));
  return true;
}

function reasonForRequeue(leasedBy: string | null): string {
  return leasedBy ? "requeued_after_server_security_challenge" : "requeued_after_extension_block";
}

async function taskIdsForUser(
  userId: string,
  conn: RunDb,
  extra: SQL<unknown>,
): Promise<string[]> {
  const rows = await conn
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .where(and(eq(matches.userId, userId), eq(tasks.status, "leased"), extra));
  return rows.map((row) => row.id);
}

async function releaseServerLeasesForUser(
  userId: string,
  conn: RunDb,
  nodeId?: string,
): Promise<void> {
  const ids = await taskIdsForUser(
    userId,
    conn,
    nodeId ? eq(tasks.leasedBy, nodeId) : sql`${tasks.leasedBy} is not null`,
  );
  if (ids.length === 0) return;
  await conn
    .update(tasks)
    .set({
      status: "pending",
      leasedAt: null,
      leasedBy: null,
      lastError: "released_for_extension_takeover",
      runAfter: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(tasks.id, ids));
}

async function releaseExtensionLeasesForUser(userId: string, conn: RunDb): Promise<void> {
  const ids = await taskIdsForUser(userId, conn, isNull(tasks.leasedBy));
  if (ids.length === 0) return;
  await conn
    .update(tasks)
    .set({ status: "pending", leasedAt: null, lastError: null, runAfter: new Date(), updatedAt: new Date() })
    .where(inArray(tasks.id, ids));
}

export async function releaseStaleExtensionLeases(
  userId: string,
  conn: RunDb = defaultDb,
): Promise<void> {
  const rows = await conn.execute(sql`
    update tasks t
    set status = 'pending', leased_at = null, last_error = 'released_stale_extension_lease',
        run_after = now(), updated_at = now()
    from matches m
    where t.match_id = m.id
      and m.user_id = ${userId}
      and t.status = 'leased'
      and t.leased_by is null
      and t.leased_at < now() - interval '15 minutes'
    returning t.id
  `);
  void rows;
}
