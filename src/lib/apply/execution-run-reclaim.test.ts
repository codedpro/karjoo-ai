/**
 * Regression guard for the run-ownership deadlock.
 *
 * A run blocked by a captcha/login could only be restarted by the exact browser
 * that blocked it. Once that executorId changed — an extension reinstall, a second
 * browser, a fresh profile — `start` matched no row, threw "queue ownership
 * changed", and the user's queue was stuck forever (observed in production: one
 * run sat blocked on `jobvision_captcha_required` for two weeks).
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { reclaimableRunCondition } from "@/lib/apply/execution-run";

const dialect = new PgDialect();

function sqlFor(executorId: string, takeover: boolean) {
  const query = dialect.sqlToQuery(reclaimableRunCondition(executorId, takeover)!);
  // Inline the bound params so the assertions read against literal values.
  return query.sql.replace(/\$(\d+)/g, (_, i) => `'${String(query.params[Number(i) - 1])}'`);
}

const EXECUTOR = "8eca1c0d-611d-4f97-90c6-7de38d249ef1";

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

  it("does not let a plain start seize a run another browser is actively running", () => {
    // A `running` run owned by a different executorId matches no branch: not null,
    // not mine, and not one of the parked states.
    const sql = sqlFor(EXECUTOR, false);
    expect(sql).not.toContain("'running'");
  });
});
