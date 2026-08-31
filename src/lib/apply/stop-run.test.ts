/**
 * Stop must work when the browser that started the run is gone.
 *
 * A run row keeps `state='running'` and its old executorId after Chrome kills the
 * service worker, so requiring a matching executorId gave the user a Stop button
 * that could never succeed — the run was owned by an executor that no longer ran.
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { STALE_RUN_MS, stoppableRunCondition } from "@/lib/apply/execution-run";

const dialect = new PgDialect();

describe("STALE_RUN_MS", () => {
  it("is long enough to outlast a busy tick but short enough to unstick a user", () => {
    // The background heartbeats every drain iteration and every discovery page,
    // so minutes of silence is death, not work.
    expect(STALE_RUN_MS).toBeGreaterThanOrEqual(60_000);
    expect(STALE_RUN_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("stoppableRunCondition", () => {
  const EXECUTOR = "d80dc00b-33b6-4cb3-bce1-48ceba650c11";

  function sqlFor(stop: boolean) {
    const query = dialect.sqlToQuery(stoppableRunCondition(EXECUTOR, stop)!);
    return { sql: query.sql, params: query.params.map((p) => String(p)) };
  }

  it("lets stop halt a run whose heartbeat went silent, whoever started it", () => {
    const { sql, params } = sqlFor(true);
    expect(sql).toContain("executor_id");
    expect(sql).toContain("heartbeat_at");
    expect(params).toContain(EXECUTOR);
    // The second bind is the staleness cutoff — a real timestamp in the past.
    const cutoff = params.find((p) => p !== EXECUTOR)!;
    expect(Number.isFinite(Date.parse(cutoff))).toBe(true);
    expect(Date.parse(cutoff)).toBeLessThan(Date.now());
  });

  it("still requires real ownership to PAUSE — that is not an emergency exit", () => {
    const { sql, params } = sqlFor(false);
    expect(sql).toContain("executor_id");
    expect(sql).not.toContain("heartbeat_at");
    expect(params).toEqual([EXECUTOR]);
  });
});
