/**
 * تست‌های انبارِ خزانه (store.ts) — با db جعلیِ کمینه (بدونِ DBِ واقعی).
 *
 * تمرکز بر مرزِ ایمنی (قاعده‌ی ۴): هر عملیات از طریقِ board_accounts به همان userId مقید
 * می‌شود؛ اگر حساب نباشد BoardAccountNotFoundError؛ و readSessionBlob فقط بلابِ همان
 * کاربر را برمی‌گرداند. هویتِ جدول‌ها با مقایسه‌ی شیِ واقعیِ drizzle تشخیص داده می‌شود.
 */
import { describe, expect, it, vi } from "vitest";

import { boardAccounts, sessionBlobs } from "@/db/schema";
import {
  BoardAccountNotFoundError,
  findBoardAccountId,
  readSessionBlob,
  upsertSessionBlob,
  type VaultStoreDb,
} from "@/lib/vault/store";

const ENCRYPTED = { ciphertext: "ct", iv: "iv", keyVersion: 1 };

/**
 * یک db جعلیِ خواندنی می‌سازد که SELECTهای زنجیره‌ای (from→innerJoin?→where→orderBy?→
 * limit) را به یک نتیجه‌ی از پیش‌تعیین‌شده نگاشت می‌کند، بسته به جدولِ مبنا.
 */
function makeReadDb(opts: {
  boardAccountRows?: unknown[];
  sessionBlobRows?: unknown[];
}): VaultStoreDb {
  function selectBuilder() {
    let baseTable: unknown;
    const builder: Record<string, unknown> = {
      from(table: unknown) {
        baseTable = table;
        return builder;
      },
      innerJoin() {
        return builder;
      },
      where() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      async limit() {
        if (baseTable === boardAccounts) return opts.boardAccountRows ?? [];
        if (baseTable === sessionBlobs) return opts.sessionBlobRows ?? [];
        return [];
      },
    };
    return builder;
  }
  return {
    select: () => selectBuilder(),
  } as unknown as VaultStoreDb;
}

describe("findBoardAccountId — مقید به userId", () => {
  it("حسابِ موجود ⇒ id", async () => {
    const db = makeReadDb({ boardAccountRows: [{ id: "ba-1" }] });
    expect(await findBoardAccountId("u1", "jobinja", db)).toBe("ba-1");
  });
  it("حسابِ ناموجود ⇒ null", async () => {
    const db = makeReadDb({ boardAccountRows: [] });
    expect(await findBoardAccountId("u1", "jobinja", db)).toBeNull();
  });
});

describe("upsertSessionBlob — قاعده‌ی ۴ (مقید به کاربر)", () => {
  it("بدونِ حسابِ متصل ⇒ BoardAccountNotFoundError (هیچ‌چیز نوشته نمی‌شود)", async () => {
    const db = makeReadDb({ boardAccountRows: [] });
    const err = await upsertSessionBlob(
      { userId: "u1", board: "jobinja", encrypted: ENCRYPTED, sessionShape: "cookie" },
      db,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BoardAccountNotFoundError);
  });

  it("با حسابِ متصل ⇒ نشستِ کهنه حذف و بلابِ تازه درج می‌شود (در یک تراکنش)", async () => {
    // db جعلی: ابتدا حساب را resolve می‌کند (select)، سپس transaction اجرا می‌شود.
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const insertReturning = vi
      .fn()
      .mockResolvedValue([{ id: "blob-1", boardAccountId: "ba-1" }]);

    const tx = {
      delete: () => ({ where: deleteWhere }),
      insert: () => ({ values: () => ({ returning: insertReturning }) }),
    };
    const db = {
      select: () =>
        ({
          from: () => ({
            where: () => ({ limit: async () => [{ id: "ba-1" }] }),
          }),
        }) as unknown,
      transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as VaultStoreDb;

    const row = await upsertSessionBlob(
      {
        userId: "u1",
        board: "jobinja",
        encrypted: ENCRYPTED,
        sessionShape: "cookie",
        expiresAt: new Date("2026-07-01T00:00:00Z"),
      },
      db,
    );

    expect(deleteWhere).toHaveBeenCalledTimes(1); // نشستِ کهنه حذف شد.
    expect(insertReturning).toHaveBeenCalledTimes(1); // بلابِ تازه درج شد.
    expect((row as { id: string }).id).toBe("blob-1");
  });
});

describe("readSessionBlob — فقط بلابِ همان کاربر", () => {
  it("بلابِ موجود ⇒ همان ردیف", async () => {
    const blob = { id: "blob-1", ciphertext: "ct", iv: "iv", keyVersion: 1 };
    const db = makeReadDb({ sessionBlobRows: [blob] });
    const out = await readSessionBlob("u1", "jobinja", db);
    expect(out).toEqual(blob);
  });

  it("نبودِ بلاب ⇒ null", async () => {
    const db = makeReadDb({ sessionBlobRows: [] });
    expect(await readSessionBlob("u1", "jobinja", db)).toBeNull();
  });
});
