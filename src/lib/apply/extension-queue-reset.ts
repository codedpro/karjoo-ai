import "server-only";

import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";

export interface ExtensionQueueResetResult {
  removed: number;
  byBoard: Record<string, number>;
}

type ResetDb = Pick<typeof defaultDb, "execute">;

/**
 * Atomically replace stale retryable work with a fresh extension-owned run.
 * Application/provider history is deliberately outside this statement.
 */
export async function resetExtensionQueue(
  userId: string,
  executorId: string,
  conn: ResetDb = defaultDb,
): Promise<ExtensionQueueResetResult> {
  const rows = await conn.execute(sql`
    with target_tasks as materialized (
      select t.id, t.match_id, l.board::text as board
      from tasks t
      inner join matches m on m.id = t.match_id
      inner join job_listings l on l.id = m.listing_id
      where m.user_id = ${userId}
        and t.status in ('pending', 'leased', 'failed', 'dead')
    ), removed as (
      delete from tasks t
      using target_tasks target
      where t.id = target.id
      returning target.board
    ), reset_matches as (
      update matches m
      set status = 'scored'::match_status, updated_at = now()
      where m.user_id = ${userId}
        and m.status = 'queued'::match_status
        and m.id in (select match_id from target_tasks)
      returning m.id
    ), reset_cursors as (
      delete from filter_cursors where user_id = ${userId}
      returning id
    ), reset_server_schedule as (
      update user_server_auto_apply
      set last_discovery_at = null, updated_at = now()
      where user_id = ${userId}
      returning id
    ), claim_run as (
      insert into apply_execution_runs (
        user_id, state, owner, executor_id, board, current_task_id,
        progress, blocked_reason, blocked_at, background_enabled,
        heartbeat_at, started_at, updated_at
      ) values (
        ${userId}, 'running', 'extension', ${executorId}, 'jobinja', null,
        ${JSON.stringify({ stage: "starting", lastDiscoveryAt: 0 })}::jsonb,
        null, null, true, now(), now(), now()
      )
      on conflict (user_id) do update set
        state = 'running',
        owner = 'extension',
        executor_id = excluded.executor_id,
        board = 'jobinja',
        current_task_id = null,
        progress = excluded.progress,
        blocked_reason = null,
        blocked_at = null,
        heartbeat_at = now(),
        started_at = now(),
        updated_at = now()
      returning id
    )
    select board, count(*)::int as count
    from removed
    where exists (select 1 from claim_run)
    group by board
  `);

  const byBoard: Record<string, number> = {};
  let removed = 0;
  for (const row of rows as unknown as Array<{ board: string; count: number }>) {
    const count = Number(row.count ?? 0);
    byBoard[row.board] = count;
    removed += count;
  }
  return { removed, byBoard };
}
