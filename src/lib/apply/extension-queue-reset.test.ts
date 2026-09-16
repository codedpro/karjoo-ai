import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { resetExtensionQueue } from "@/lib/apply/extension-queue-reset";

describe("extension queue reset", () => {
  it("returns removed counts grouped by provider", async () => {
    const execute = vi.fn(async () => [
      { board: "jobinja", count: 12 },
      { board: "e-estekhdam", count: 3 },
    ]);

    await expect(resetExtensionQueue("user-1", "11111111-1111-4111-8111-111111111111", {
      execute,
    } as never)).resolves.toEqual({
      removed: 15,
      byBoard: { jobinja: 12, "e-estekhdam": 3 },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps history and verification outside the destructive scope", () => {
    const source = readFileSync("src/lib/apply/extension-queue-reset.ts", "utf8");
    expect(source).toContain("t.status in ('pending', 'leased', 'failed', 'dead')");
    expect(source).not.toContain("delete from applications");
    expect(source).not.toContain("delete from board_applications");
    expect(source).not.toContain("'verifying', 'succeeded'");
  });

  it("resets deduplication state, cursors, and extension ownership atomically", () => {
    const source = readFileSync("src/lib/apply/extension-queue-reset.ts", "utf8");
    expect(source).toContain("with target_tasks as materialized");
    expect(source).toContain("set status = 'scored'::match_status");
    expect(source).toContain("delete from filter_cursors where user_id");
    expect(source).toContain("owner = 'extension'");
    expect(source).toContain("executor_id = excluded.executor_id");
    const conflictUpdate = source.slice(source.indexOf("on conflict (user_id)"));
    expect(conflictUpdate).not.toContain("background_enabled = true");
  });
});
