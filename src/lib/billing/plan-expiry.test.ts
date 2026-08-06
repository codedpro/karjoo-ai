/**
 * تست‌های انقضای پلن — پلن‌های پولیِ گذشته از مهلت باید به free برگردند.
 *
 * DB تزریق می‌شود (بدونِ DB/شبکه‌ی زنده). تمرکز روی *شرطِ* update است، چون نشتِ درآمد
 * دقیقاً همان‌جا بود: بدونِ این کار، یک پرداخت رده را برای همیشه می‌داد.
 */
import { describe, expect, it, vi } from "vitest";

import { PLAN_GRACE_HOURS, expireLapsedPlans } from "@/lib/billing/plan-expiry";

/** DBِ جعلی: شرطِ where و مقادیرِ set را ضبط می‌کند و ردیف‌های دلخواه برمی‌گرداند. */
function fakeDb(returned: { id: string }[]) {
  const captured: { set?: Record<string, unknown>; whereCalled: boolean } = {
    whereCalled: false,
  };
  const db = {
    update: vi.fn(() => ({
      set(values: Record<string, unknown>) {
        captured.set = values;
        return {
          where() {
            captured.whereCalled = true;
            return {
              returning: async () => returned,
            };
          },
        };
      },
    })),
  };
  return { db: db as never, captured };
}

describe("expireLapsedPlans", () => {
  it("پلن‌های گذشته از مهلت را به free برمی‌گرداند و انقضا را پاک می‌کند", async () => {
    const { db, captured } = fakeDb([{ id: "u1" }, { id: "u2" }]);

    const result = await expireLapsedPlans(db, new Date("2026-08-06T12:00:00Z"));

    expect(result.downgraded).toBe(2);
    expect(result.userIds).toEqual(["u1", "u2"]);
    // پلن به free و انقضا null — وگرنه دفعه‌ی بعد دوباره هدف می‌شد.
    expect(captured.set?.plan).toBe("free");
    expect(captured.set?.planExpiresAt).toBeNull();
    expect(captured.whereCalled).toBe(true);
  });

  it("چیزی برای انقضا نباشد → downgraded=0 (ایدمپوتنت)", async () => {
    const { db } = fakeDb([]);

    const result = await expireLapsedPlans(db, new Date("2026-08-06T12:00:00Z"));

    expect(result.downgraded).toBe(0);
    expect(result.userIds).toEqual([]);
  });

  it("مهلتِ ارفاق تعریف شده و مثبت است (تمدیدِ کمی دیرتر کاربر را قطع نکند)", () => {
    expect(PLAN_GRACE_HOURS).toBeGreaterThan(0);
  });
});
