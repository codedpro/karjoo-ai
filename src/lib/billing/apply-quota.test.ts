/**
 * تست‌های سهمیه‌ی اپلای روزانه (apply-quota.ts) — با readCountToday تزریقی (بدونِ DB).
 */
import { describe, expect, it } from "vitest";

import { assertApplyQuota } from "@/lib/billing/apply-quota";
import { ApplyQuotaError } from "@/lib/billing/errors";
import { testEntitlements } from "@/lib/billing/entitlements";

const FREE = testEntitlements();
const UNLIMITED = testEntitlements({ unlimitedApplies: true });

describe("assertApplyQuota — پلنِ Free (سقفِ ۱۰۰/روز)", () => {
  it("زیرِ سقف ⇒ مجاز و باقی‌مانده درست", async () => {
    const out = await assertApplyQuota("u1", FREE, {
      readCountToday: async () => 42,
    });
    expect(out).toEqual({ limit: 100, usedToday: 42, remaining: 58 });
  });

  it("درست زیرِ سقف (۹۹) ⇒ هنوز مجاز", async () => {
    const out = await assertApplyQuota("u1", FREE, {
      readCountToday: async () => 99,
    });
    expect(out.remaining).toBe(1);
  });

  it("رسیدن به سقف (۱۰۰) ⇒ ApplyQuotaError", async () => {
    const err = await assertApplyQuota("u1", FREE, {
      readCountToday: async () => 100,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApplyQuotaError);
    expect((err as ApplyQuotaError).code).toBe("apply_quota_exceeded");
    expect((err as ApplyQuotaError).usedToday).toBe(100);
    expect((err as ApplyQuotaError).limit).toBe(100);
  });

  it("بالای سقف ⇒ ApplyQuotaError", async () => {
    const err = await assertApplyQuota("u1", FREE, {
      readCountToday: async () => 250,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApplyQuotaError);
  });
});

describe("assertApplyQuota — اشتراک‌های «اپلای نامحدود»", () => {
  it("اپلای نامحدود (با/بدونِ ورکر) بدونِ سقف و بدونِ شمارش عبور می‌کند", async () => {
    const variants = [
      UNLIMITED,
      testEntitlements({ unlimitedApplies: true, workerIpLimit: 1, status: "active" }),
      testEntitlements({ unlimitedApplies: true, workerIpLimit: 5, status: "active" }),
    ];
    for (const e of variants) {
      let counted = false;
      const out = await assertApplyQuota("u1", e, {
        readCountToday: async () => {
          counted = true;
          return 99_999;
        },
      });
      expect(out).toEqual({ limit: null, usedToday: 0, remaining: null });
      expect(counted, "نباید برای اشتراکِ نامحدود شمارش بزند").toBe(false);
    }
  });

  it("اشتراکِ فعال بدونِ اپلای نامحدود ⇒ همان سقفِ ۱۰۰", async () => {
    const out = await assertApplyQuota(
      "u1",
      testEntitlements({ status: "active", planKey: "plus" }),
      { readCountToday: async () => 5 },
    );
    expect(out.limit).toBe(100);
    expect(out.remaining).toBe(95);
  });
});
