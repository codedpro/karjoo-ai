/**
 * تست‌های race-safe بودنِ storeِ تولید (drizzleGrantStore) — بدونِ DBِ واقعی.
 *
 * این تست‌ها قراردادِ ایدمپوتنسیِ مبتنی‌بر DB را قفل می‌کنند (یافته‌ی HIGH): گرنتِ
 * دومِ همان (کاربر، ماه) باید روی ایندکسِ partial unique برخورد کند (درجِ ۰ ردیف)،
 * نتیجه already=true شود، و *creditِ همان تراکنش rollback شود* تا موجودی دوبار افزایش نیابد.
 *
 * یک db/tx جعلیِ کمینه می‌سازیم که رفتارِ دو چیز را شبیه‌سازی می‌کند:
 *   ۱) ایندکسِ partial unique روی ردیف‌های 'grant' — درجِ تکراریِ یک refId ۰ ردیف می‌دهد.
 *   ۲) اتمیک‌بودنِ تراکنش — creditها فقط هنگامِ commitِ موفق (نبودِ throw) تثبیت می‌شوند.
 *
 * هویتِ جدولِ walletLedger با مقایسه‌ی شیِ واقعیِ drizzle تشخیص داده می‌شود؛ پس تست
 * به ساختارِ داخلیِ کوئری‌بیلدر وابسته نیست، فقط به ترتیبِ متدها در grantOnce.
 */
import { describe, expect, it } from "vitest";

import { walletLedger } from "@/db/schema";
import { drizzleGrantStore, type GrantsDb } from "@/lib/billing/grants";

const AMOUNT = 100_000;

/** db/tx جعلی که یکتاییِ refIdِ گرنت و اتمیک‌بودنِ تراکنش را شبیه‌سازی می‌کند. */
function makeFakeDb() {
  // وضعیتِ «commit‌شده» — منبعِ حقیقت پس از هر تراکنشِ موفق.
  const committedGrantRefs = new Set<string>();
  const committedBalances = new Map<string, number>();

  function makeTx(
    pendingGrantRefs: Set<string>,
    pendingBalances: Map<string, number>,
  ) {
    return {
      insert(table: unknown) {
        let values: Record<string, unknown> = {};
        const builder = {
          values(v: Record<string, unknown>) {
            values = v;
            return builder;
          },
          onConflictDoNothing() {
            return builder;
          },
          async returning() {
            // فقط درجِ walletLedger می‌تواند برخورد کند (ردیفِ 'grant').
            if (table === walletLedger) {
              const refId = String(values.refId);
              if (committedGrantRefs.has(refId) || pendingGrantRefs.has(refId)) {
                return []; // برخوردِ ایندکسِ partial unique → ۰ ردیف.
              }
              pendingGrantRefs.add(refId);
              return [{ id: `ledger-${refId}` }];
            }
            return [{ id: "ignored" }];
          },
          // insert(wallets) بدونِ returning، مستقیماً await می‌شود.
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(undefined).then(resolve, reject);
          },
        };
        return builder;
      },
      update() {
        let userId = "";
        const builder = {
          set() {
            return builder;
          },
          where(predicate: { userId?: string }) {
            // userId را از آرگومانِ تست استخراج نمی‌کنیم؛ از closure می‌گیریم.
            void predicate;
            return builder;
          },
          async returning() {
            const base =
              pendingBalances.get(userId) ?? committedBalances.get(userId) ?? 0;
            const next = base + currentAmount;
            pendingBalances.set(userId, next);
            return [{ balanceToman: next }];
          },
          _bindUser(id: string) {
            userId = id;
            return builder;
          },
        };
        // userId را از متغیرِ جاریِ تراکنش می‌گیریم.
        builder._bindUser(currentUserId);
        return builder;
      },
    };
  }

  // متغیرهای جاری برای پل‌زدنِ آرگومان‌های grantOnce به fakeِ بدونِ‌حالتِ بیلدر.
  let currentUserId = "";
  let currentAmount = 0;

  const db = {
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const pendingGrantRefs = new Set<string>();
      const pendingBalances = new Map<string, number>();
      const tx = makeTx(pendingGrantRefs, pendingBalances);
      const out = await fn(tx); // اگر throw کند، هیچ‌چیزِ pending تثبیت نمی‌شود (rollback).
      for (const r of pendingGrantRefs) committedGrantRefs.add(r);
      for (const [u, b] of pendingBalances) committedBalances.set(u, b);
      return out;
    },
  } as unknown as GrantsDb;

  return {
    db,
    committedGrantRefs,
    committedBalances,
    bind(userId: string, amount: number) {
      currentUserId = userId;
      currentAmount = amount;
    },
  };
}

describe("drizzleGrantStore — ایدمپوتنسیِ مبتنی بر DB (race-safe)", () => {
  it("اولین گرنت: درج موفق، credit اعمال، already=false", async () => {
    const fake = makeFakeDb();
    fake.bind("u1", AMOUNT);
    const store = drizzleGrantStore(fake.db);

    const res = await store.grantOnce({
      userId: "u1",
      amount: AMOUNT,
      refId: "grant:u1:2026-06",
      description: "test",
      now: Date.now(),
    });

    expect(res.already).toBe(false);
    expect(fake.committedGrantRefs.has("grant:u1:2026-06")).toBe(true);
    expect(fake.committedBalances.get("u1")).toBe(AMOUNT);
  });

  it("گرنتِ دومِ همان (کاربر، ماه): برخورد ⇒ already=true و credit rollback (موجودی ثابت)", async () => {
    const fake = makeFakeDb();
    fake.bind("u1", AMOUNT);
    const store = drizzleGrantStore(fake.db);

    const first = await store.grantOnce({
      userId: "u1",
      amount: AMOUNT,
      refId: "grant:u1:2026-06",
      description: "test",
      now: Date.now(),
    });
    const second = await store.grantOnce({
      userId: "u1",
      amount: AMOUNT,
      refId: "grant:u1:2026-06",
      description: "test",
      now: Date.now(),
    });

    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
    // تضمینِ اصلیِ یافته: creditِ تراکنشِ دوم rollback شد — موجودی فقط یک‌بار افزایش یافت.
    expect(fake.committedBalances.get("u1")).toBe(AMOUNT);
    expect(fake.committedGrantRefs.size).toBe(1);
  });

  it("ماهِ متفاوت ⇒ refIdِ متفاوت ⇒ گرنتِ جدا و معتبر (هر دو credit)", async () => {
    const fake = makeFakeDb();
    fake.bind("u1", AMOUNT);
    const store = drizzleGrantStore(fake.db);

    const june = await store.grantOnce({
      userId: "u1",
      amount: AMOUNT,
      refId: "grant:u1:2026-06",
      description: "june",
      now: Date.now(),
    });
    const july = await store.grantOnce({
      userId: "u1",
      amount: AMOUNT,
      refId: "grant:u1:2026-07",
      description: "july",
      now: Date.now(),
    });

    expect(june.already).toBe(false);
    expect(july.already).toBe(false);
    expect(fake.committedBalances.get("u1")).toBe(AMOUNT * 2);
    expect(fake.committedGrantRefs.size).toBe(2);
  });
});
