/**
 * تست‌های سهمیه‌ی اپلای روزانه (apply-quota.ts) — با readCountToday تزریقی (بدونِ DB).
 */
import { describe, expect, it } from "vitest";

import { assertApplyQuota } from "@/lib/billing/apply-quota";
import { ApplyQuotaError } from "@/lib/billing/errors";

describe("assertApplyQuota — پلنِ Free (سقفِ ۱۰۰/روز)", () => {
  it("زیرِ سقف ⇒ مجاز و باقی‌مانده درست", async () => {
    const out = await assertApplyQuota("u1", "free", {
      readCountToday: async () => 42,
    });
    expect(out).toEqual({ limit: 100, usedToday: 42, remaining: 58 });
  });

  it("درست زیرِ سقف (۹۹) ⇒ هنوز مجاز", async () => {
    const out = await assertApplyQuota("u1", "free", {
      readCountToday: async () => 99,
    });
    expect(out.remaining).toBe(1);
  });

  it("رسیدن به سقف (۱۰۰) ⇒ ApplyQuotaError", async () => {
    const err = await assertApplyQuota("u1", "free", {
      readCountToday: async () => 100,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApplyQuotaError);
    expect((err as ApplyQuotaError).code).toBe("apply_quota_exceeded");
    expect((err as ApplyQuotaError).usedToday).toBe(100);
    expect((err as ApplyQuotaError).limit).toBe(100);
  });

  it("بالای سقف ⇒ ApplyQuotaError", async () => {
    const err = await assertApplyQuota("u1", "free", {
      readCountToday: async () => 250,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApplyQuotaError);
  });
});

describe("assertApplyQuota — پلن‌های پولی (نامحدود)", () => {
  it("Pro/Max/MaxPlus بدونِ سقف و بدونِ شمارش عبور می‌کنند", async () => {
    for (const plan of ["pro", "max", "maxplus"] as const) {
      let counted = false;
      const out = await assertApplyQuota("u1", plan, {
        readCountToday: async () => {
          counted = true;
          return 99_999;
        },
      });
      expect(out).toEqual({ limit: null, usedToday: 0, remaining: null });
      expect(counted, "نباید برای پلنِ نامحدود شمارش بزند").toBe(false);
    }
  });

  it("پلن‌های تاریخی: premium نامحدود (→pro)، payg محدود (→free)", async () => {
    const premium = await assertApplyQuota("u1", "premium", {
      readCountToday: async () => 99_999,
    });
    expect(premium.limit).toBeNull();

    const payg = await assertApplyQuota("u1", "payg", {
      readCountToday: async () => 5,
    });
    expect(payg.limit).toBe(100);
    expect(payg.remaining).toBe(95);
  });
});
