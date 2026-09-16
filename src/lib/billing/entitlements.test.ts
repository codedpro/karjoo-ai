/**
 * تست‌های مزایای کارجو از اشتراکِ 1xai (entitlements.ts) — خالص، بدونِ DB/شبکه.
 *
 * تضمین‌ها:
 *   • کلیدهای karjoo_* در features به مزایا نگاشت می‌شوند.
 *   • نبودِ کلیدها → رفتارِ رایگان (سقفِ ۱۰۰، بدونِ ورکر) — حتی برای اشتراکِ فعال.
 *   • تعدادِ ورکرِ منفی/NaN/نامعتبر → ۰ (هرگز مزیتِ پولیِ جعلی).
 */
import { describe, expect, it } from "vitest";

import {
  FREE_APPLY_QUOTA_PER_DAY,
  FREE_ENTITLEMENTS,
  applyQuotaOf,
  entitlementsFromSubscription,
  testEntitlements,
  workerIpLimitOf,
} from "@/lib/billing/entitlements";

function sub(features: Record<string, unknown>, over: Partial<{ status: "active" | "free" }> = {}) {
  return {
    planKey: "pro",
    nameFa: "حرفه‌ای",
    status: over.status ?? ("active" as const),
    periodEnd: new Date("2026-10-01T00:00:00Z"),
    features,
  };
}

describe("entitlementsFromSubscription", () => {
  it("کلیدهای karjoo_* را به مزایا نگاشت می‌کند", () => {
    const e = entitlementsFromSubscription(
      sub({ karjoo_unlimited_applies: true, karjoo_worker_ips: 5 }),
    );
    expect(e).toEqual({
      planKey: "pro",
      planNameFa: "حرفه‌ای",
      status: "active",
      periodEnd: new Date("2026-10-01T00:00:00Z"),
      unlimitedApplies: true,
      workerIpLimit: 5,
    });
  });

  it("نبودِ کلیدهای کارجو → بدونِ اپلای نامحدود و بدونِ ورکر (مثلِ رایگان)", () => {
    const e = entitlementsFromSubscription(sub({ some_other_feature: 1 }));
    expect(e.status).toBe("active");
    expect(e.unlimitedApplies).toBe(false);
    expect(e.workerIpLimit).toBe(0);
    expect(applyQuotaOf(e)).toBe(FREE_APPLY_QUOTA_PER_DAY);
    expect(workerIpLimitOf(e)).toBe(0);
  });

  it("فقط true صریح اپلای نامحدود می‌دهد (نه رشته/عدد)", () => {
    expect(entitlementsFromSubscription(sub({ karjoo_unlimited_applies: "true" })).unlimitedApplies).toBe(false);
    expect(entitlementsFromSubscription(sub({ karjoo_unlimited_applies: 1 })).unlimitedApplies).toBe(false);
  });

  it("تعدادِ ورکرِ منفی/NaN/نامعتبر → ۰", () => {
    for (const v of [-3, Number.NaN, "abc", Number.POSITIVE_INFINITY, null]) {
      expect(entitlementsFromSubscription(sub({ karjoo_worker_ips: v })).workerIpLimit).toBe(0);
    }
  });

  it("تعدادِ ورکرِ اعشاری/رشته‌ای عددی → گرد به پایین", () => {
    expect(entitlementsFromSubscription(sub({ karjoo_worker_ips: 2.9 })).workerIpLimit).toBe(2);
    expect(entitlementsFromSubscription(sub({ karjoo_worker_ips: "3" })).workerIpLimit).toBe(3);
  });

  it("وضعیتِ free و periodEnd=null همان‌طور حفظ می‌شود", () => {
    const e = entitlementsFromSubscription({
      planKey: "free",
      nameFa: "رایگان",
      status: "free",
      periodEnd: null,
      features: {},
    });
    expect(e).toEqual(FREE_ENTITLEMENTS);
  });
});

describe("applyQuotaOf / workerIpLimitOf", () => {
  it("بدونِ اپلای نامحدود → سقفِ ۱۰۰", () => {
    expect(FREE_APPLY_QUOTA_PER_DAY).toBe(100);
    expect(applyQuotaOf(FREE_ENTITLEMENTS)).toBe(100);
  });

  it("اپلای نامحدود → null", () => {
    expect(applyQuotaOf(testEntitlements({ unlimitedApplies: true }))).toBeNull();
  });

  it("سقفِ ورکر همان workerIpLimit است", () => {
    expect(workerIpLimitOf(FREE_ENTITLEMENTS)).toBe(0);
    expect(workerIpLimitOf(testEntitlements({ workerIpLimit: 5 }))).toBe(5);
  });

  it("testEntitlements پیش‌فرضِ رایگان را بدونِ تغییرِ FREE_ENTITLEMENTS وصله می‌کند", () => {
    const e = testEntitlements({ workerIpLimit: 1 });
    expect(e.planKey).toBe("free");
    expect(e.workerIpLimit).toBe(1);
    expect(FREE_ENTITLEMENTS.workerIpLimit).toBe(0);
  });
});
