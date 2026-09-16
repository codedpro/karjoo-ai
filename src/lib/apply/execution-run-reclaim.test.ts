/**
 * Regression guard for the run-ownership deadlock.
 *
 * A run blocked by a captcha/login could only be restarted by the exact browser
 * that blocked it. Once that executorId changed — an extension reinstall, a second
 * browser, a fresh profile — `start` matched no row, threw "queue ownership
 * changed", and the user's queue was stuck forever (observed in production: one
 * run sat blocked on `jobvision_captcha_required` for two weeks).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { reclaimableRunCondition, STALE_RUN_MS } from "@/lib/apply/execution-run";

const dialect = new PgDialect();

function sqlFor(executorId: string, takeover: boolean) {
  const query = dialect.sqlToQuery(reclaimableRunCondition(executorId, takeover)!);
  // Inline the bound params so the assertions read against literal values.
  return query.sql.replace(/\$(\d+)/g, (_, i) => `'${String(query.params[Number(i) - 1])}'`);
}

const EXECUTOR = "8eca1c0d-611d-4f97-90c6-7de38d249ef1";
const source = readFileSync("src/lib/apply/execution-run.ts", "utf8");

describe("reclaimableRunCondition", () => {
  it("lets any browser reclaim a blocked run — the deadlock fix", () => {
    expect(sqlFor(EXECUTOR, false)).toContain("'blocked'");
    expect(sqlFor(EXECUTOR, true)).toContain("'blocked'");
  });

  it("still accepts an unowned, paused, or completed run without takeover", () => {
    const sql = sqlFor(EXECUTOR, false);
    expect(sql).toContain('"owner" is null');
    expect(sql).toContain("'paused'");
    expect(sql).toContain("'completed'");
  });

  it("still lets the owning browser reclaim its own run", () => {
    for (const takeover of [false, true]) {
      const sql = sqlFor(EXECUTOR, takeover);
      expect(sql).toContain("'extension'");
      expect(sql).toContain(`'${EXECUTOR}'`);
    }
  });

  it("only takeover may seize a run that the server is actively executing", () => {
    expect(sqlFor(EXECUTOR, true)).toContain("'server'");
    expect(sqlFor(EXECUTOR, false)).not.toContain("'server'");
  });

  it("takeover also lifts a run held by another browser", () => {
    // Without this the panel could show a takeover button that always failed:
    // a second browser holding the run locked the user out entirely.
    const sql = sqlFor(EXECUTOR, true);
    expect(sql).toContain("'extension'");
    expect(sql.match(/'extension'/g)!.length).toBeGreaterThanOrEqual(1);
  });

  it("startExtensionExecution does not reject another-browser takeover before SQL reclaim runs", () => {
    expect(source).toContain("current.state === \"running\" &&\n    !opts.takeover");
  });

  it("startExtensionExecution lets plain start recover stale another-browser runs", () => {
    expect(source).toContain("!runViewHeartbeatStale(current)");
  });

  it("a plain start still refuses a run another browser is actively running", () => {
    const sql = sqlFor(EXECUTOR, false);
    // `mine` still names 'extension', but only paired with this executor id.
    expect(sql).toContain(EXECUTOR);
    expect(sql).not.toContain("'running'");
  });

  it("does not let a plain start seize a run another browser is actively running", () => {
    // A `running` run owned by a different executorId matches no branch: not null,
    // not mine, and not one of the parked states. Staleness is the one exception,
    // and it is a heartbeat comparison rather than a state literal.
    const sql = sqlFor(EXECUTOR, false);
    expect(sql).not.toContain("'running'");
  });

  it("lets any browser reclaim a run whose heartbeat died", () => {
    // Observed in production: a run left state=running owner=extension with a
    // 29-minute-old heartbeat after the browser went away mid-cycle. Nobody was
    // executing it, but only the original executorId could reclaim it, so the
    // panel sat on «متوقف شده — اجرا در مرورگر ادامه پیدا نکرد» with no way back.
    const sql = sqlFor(EXECUTOR, false);
    expect(sql).toContain('"heartbeat_at" <');
  });

  it("does not reclaim a run that is still heartbeating", () => {
    // The cutoff must be a moving window, not "any heartbeat" — otherwise a
    // healthy second browser would be robbed of its run by a plain start.
    const before = Date.now();
    const sql = sqlFor(EXECUTOR, false);
    const stamp = /"heartbeat_at" < '([^']+)'/.exec(sql)?.[1];
    expect(stamp).toBeDefined();
    const cutoff = new Date(stamp!).getTime();
    expect(cutoff).toBeLessThanOrEqual(before - STALE_RUN_MS + 1_000);
    expect(cutoff).toBeGreaterThan(before - STALE_RUN_MS - 60_000);
  });
});
