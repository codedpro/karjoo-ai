import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  invalidatePendingQueueForFilters,
  stalePendingQueueCondition,
} from "@/lib/apply/queue-refilter";

const dialect = new PgDialect();

describe("invalidatePendingQueueForFilters", () => {
  it("does no database work when no provider targeting changed", async () => {
    let transactionCalled = false;
    const db = {
      transaction: async () => {
        transactionCalled = true;
        throw new Error("must not run");
      },
    };

    await expect(
      invalidatePendingQueueForFilters("user-1", [], db as never),
    ).resolves.toEqual({ removed: 0, boards: [] });
    expect(transactionCalled).toBe(false);
  });

  it("targets only pending, non-manual tasks owned by the user on changed boards", () => {
    const query = dialect.sqlToQuery(
      stalePendingQueueCondition("user-1", ["jobinja", "irantalent"])!,
    );
    expect(query.sql).toContain('"tasks"."status" = $2');
    expect(query.sql).toContain("->> 'mode'");
    expect(query.sql).toContain("<> 'manual'");
    expect(query.params).toEqual(["user-1", "pending", "jobinja", "irantalent"]);
  });
});
