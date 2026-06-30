/**
 * تست‌های کانالِ فرمان (commands.ts) — با db/now تزریقی (بدونِ DB).
 *
 * تمرکز: قاعده‌ی ۴ — فرمانِ 'update' مسیرِ اسکریپتِ به‌روزرسانی را در payload می‌گذارد؛
 * poll فقط pendingهای همان نود را می‌دهد؛ ack وضعیت/زمان‌ها/result را درست ست می‌کند.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ackCommand,
  issueCommand,
  pollCommands,
  type FleetCommandsDb,
} from "@/lib/fleet/commands";

function makeInsertDb(returnedRow: unknown): {
  db: FleetCommandsDb;
  values: ReturnType<typeof vi.fn>;
} {
  const values = vi.fn().mockReturnValue({ returning: async () => [returnedRow] });
  const db = { insert: () => ({ values }) } as unknown as FleetCommandsDb;
  return { db, values };
}

describe("issueCommand", () => {
  it("فرمانِ update ⇒ updateScript در payload گذاشته می‌شود (advisory)", async () => {
    const { db, values } = makeInsertDb({ id: "c1", command: "update" });
    await issueCommand("n1", "update", {}, { db, updateScript: "./deploy.sh" });
    const written = values.mock.calls[0][0] as {
      command: string;
      payload: Record<string, unknown>;
      status: string;
    };
    expect(written.command).toBe("update");
    expect(written.status).toBe("pending");
    expect(written.payload.updateScript).toBe("./deploy.sh");
  });

  it("فرمانِ update با updateScript صریح در payload ⇒ override نمی‌شود", async () => {
    const { db, values } = makeInsertDb({ id: "c1" });
    await issueCommand(
      "n1",
      "update",
      { payload: { updateScript: "./custom.sh", targetVersion: "2.0.0" } },
      { db, updateScript: "./deploy.sh" },
    );
    const written = values.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(written.payload.updateScript).toBe("./custom.sh");
    expect(written.payload.targetVersion).toBe("2.0.0");
  });

  it("فرمانِ restart ⇒ updateScript اضافه نمی‌شود", async () => {
    const { db, values } = makeInsertDb({ id: "c2", command: "restart" });
    await issueCommand("n1", "restart", {}, { db, updateScript: "./deploy.sh" });
    const written = values.mock.calls[0][0] as {
      command: string;
      payload: Record<string, unknown>;
    };
    expect(written.command).toBe("restart");
    expect("updateScript" in written.payload).toBe(false);
  });
});

describe("pollCommands — فقط pendingهای همین نود", () => {
  it("ردیف‌های pending را برمی‌گرداند", async () => {
    const rows = [{ id: "c1", nodeId: "n1", status: "pending" }];
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ orderBy: async () => rows }) }),
      }),
    } as unknown as FleetCommandsDb;
    expect(await pollCommands("n1", db)).toEqual(rows);
  });
});

describe("ackCommand — وضعیت/زمان‌ها/result", () => {
  function makeUpdateDb(returnedRow: unknown): {
    db: FleetCommandsDb;
    set: ReturnType<typeof vi.fn>;
  } {
    const set = vi.fn().mockReturnValue({
      where: () => ({ returning: async () => (returnedRow ? [returnedRow] : []) }),
    });
    const db = { update: () => ({ set }) } as unknown as FleetCommandsDb;
    return { db, set };
  }

  const fixedNow = () => 1_700_000_000_000;

  it("acked ⇒ ackedAt ست می‌شود، completedAt نه", async () => {
    const { db, set } = makeUpdateDb({ id: "c1", status: "acked" });
    await ackCommand("c1", "acked", undefined, { db, now: fixedNow });
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("acked");
    expect(patch.ackedAt).toEqual(new Date(fixedNow()));
    expect("completedAt" in patch).toBe(false);
  });

  it("done ⇒ completedAt + result ست می‌شوند", async () => {
    const { db, set } = makeUpdateDb({ id: "c1", status: "done" });
    await ackCommand("c1", "done", { exitCode: 0 }, { db, now: fixedNow });
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("done");
    expect(patch.completedAt).toEqual(new Date(fixedNow()));
    expect(patch.result).toEqual({ exitCode: 0 });
    expect("ackedAt" in patch).toBe(false);
  });

  it("failed ⇒ completedAt + result", async () => {
    const { db, set } = makeUpdateDb({ id: "c1", status: "failed" });
    await ackCommand("c1", "failed", { error: "pull failed" }, { db, now: fixedNow });
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.status).toBe("failed");
    expect(patch.completedAt).toEqual(new Date(fixedNow()));
    expect(patch.result).toEqual({ error: "pull failed" });
  });

  it("فرمانِ ناموجود ⇒ null", async () => {
    const { db } = makeUpdateDb(null);
    expect(await ackCommand("missing", "done", undefined, { db })).toBeNull();
  });
});
