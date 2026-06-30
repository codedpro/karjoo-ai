/**
 * تست‌های تخصیصِ نود (assign.ts) — با tx جعلی (بدونِ DB).
 *
 * تمرکز: قاعده‌ی ۲ — سقفِ IPِ پلن هنگامِ تخصیص اعمال می‌شود (Free/Pro=۰ → همیشه رد؛
 * Max=۱؛ MaxPlus=۵)؛ تخصیصِ تکراری idempotent است و سقف را نمی‌شکند.
 */
import { describe, expect, it, vi } from "vitest";

import {
  assignNodeToUser,
  unassignNodeFromUser,
  listAssignments,
  listUserIdsForNode,
  WorkerIpLimitError,
  type FleetAssignDb,
} from "@/lib/fleet/assign";

/**
 * یک tx جعلی می‌سازد که دو شکلِ SELECT را تفکیک می‌کند:
 *   • select()  (بدونِ projection) → existing-check: from().where().limit() ⇒ existingRows.
 *   • select({n}) (با projection)  → count: from().where() ⇒ [{ n: count }] (مستقیم await).
 * و insert().values().onConflictDoNothing().returning() ⇒ insertedRow.
 */
function makeTx(opts: {
  existing?: unknown;
  count?: number;
  inserted?: unknown;
}) {
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoNothing: () => ({
      returning: async () => (opts.inserted ? [opts.inserted] : []),
    }),
  });

  const tx = {
    select: (projection?: unknown) => {
      if (projection === undefined) {
        // existing-check.
        return {
          from: () => ({
            where: () => ({
              limit: async () => (opts.existing ? [opts.existing] : []),
            }),
          }),
        };
      }
      // count — یک thenable که مستقیم await می‌شود (بدونِ limit).
      const countRows = [{ n: opts.count ?? 0 }];
      return {
        from: () => ({
          where: () => Promise.resolve(countRows),
        }),
      };
    },
    insert: () => ({ values: insertValues }),
  };
  return { tx, insertValues };
}

/** db جعلی که transaction(fn) را با یک tx از پیش‌ساخته اجرا می‌کند. */
function makeDb(tx: unknown): FleetAssignDb {
  return {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as FleetAssignDb;
}

describe("assignNodeToUser — سقفِ IPِ پلن (قاعده‌ی ۲)", () => {
  it("پلنِ free (سقف ۰) ⇒ WorkerIpLimitError، بدونِ درج", async () => {
    const { tx, insertValues } = makeTx({ existing: undefined });
    const err = await assignNodeToUser("u1", "n1", "free", makeDb(tx)).catch((e) => e);
    expect(err).toBeInstanceOf(WorkerIpLimitError);
    expect((err as WorkerIpLimitError).limit).toBe(0);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("پلنِ pro (سقف ۰) ⇒ WorkerIpLimitError", async () => {
    const { tx } = makeTx({ existing: undefined });
    const err = await assignNodeToUser("u1", "n1", "pro", makeDb(tx)).catch((e) => e);
    expect(err).toBeInstanceOf(WorkerIpLimitError);
    expect((err as WorkerIpLimitError).limit).toBe(0);
  });

  it("پلنِ max، زیرِ سقف (۰ از ۱) ⇒ درج می‌شود", async () => {
    const inserted = { id: "a1", userId: "u1", nodeId: "n1" };
    const { tx, insertValues } = makeTx({ existing: undefined, count: 0, inserted });
    const out = await assignNodeToUser("u1", "n1", "max", makeDb(tx));
    expect(out).toEqual(inserted);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("پلنِ max، سقف پر (۱ از ۱) ⇒ WorkerIpLimitError، بدونِ درج", async () => {
    const { tx, insertValues } = makeTx({ existing: undefined, count: 1 });
    const err = await assignNodeToUser("u1", "n2", "max", makeDb(tx)).catch((e) => e);
    expect(err).toBeInstanceOf(WorkerIpLimitError);
    const e = err as WorkerIpLimitError;
    expect(e.limit).toBe(1);
    expect(e.assigned).toBe(1);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("پلنِ maxplus، زیرِ سقف (۴ از ۵) ⇒ درج می‌شود", async () => {
    const inserted = { id: "a5", userId: "u1", nodeId: "n5" };
    const { tx } = makeTx({ existing: undefined, count: 4, inserted });
    const out = await assignNodeToUser("u1", "n5", "maxplus", makeDb(tx));
    expect(out).toEqual(inserted);
  });

  it("تخصیصِ تکراری ⇒ همان ردیفِ موجود، بدونِ درج و بدونِ احتسابِ سقف", async () => {
    const existing = { id: "a1", userId: "u1", nodeId: "n1" };
    // حتی اگر سقف ۰ باشد (free)، چون از قبل تخصیص یافته، نباید خطا بدهد.
    const { tx, insertValues } = makeTx({ existing });
    const out = await assignNodeToUser("u1", "n1", "free", makeDb(tx));
    expect(out).toEqual(existing);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("unassignNodeFromUser", () => {
  it("ردیفِ موجود ⇒ true", async () => {
    const db = {
      delete: () => ({
        where: () => ({ returning: async () => [{ id: "a1" }] }),
      }),
    } as unknown as FleetAssignDb;
    expect(await unassignNodeFromUser("u1", "n1", db)).toBe(true);
  });

  it("ردیفِ ناموجود ⇒ false", async () => {
    const db = {
      delete: () => ({
        where: () => ({ returning: async () => [] }),
      }),
    } as unknown as FleetAssignDb;
    expect(await unassignNodeFromUser("u1", "n1", db)).toBe(false);
  });
});

describe("listAssignments / listUserIdsForNode", () => {
  it("listAssignments ⇒ ردیف‌های کاربر", async () => {
    const rows = [{ id: "a1", userId: "u1", nodeId: "n1" }];
    const db = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as FleetAssignDb;
    expect(await listAssignments("u1", db)).toEqual(rows);
  });

  it("listUserIdsForNode ⇒ فقط userIdها", async () => {
    const db = {
      select: () => ({
        from: () => ({ where: async () => [{ userId: "u1" }, { userId: "u2" }] }),
      }),
    } as unknown as FleetAssignDb;
    expect(await listUserIdsForNode("n1", db)).toEqual(["u1", "u2"]);
  });
});
