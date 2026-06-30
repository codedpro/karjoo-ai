/**
 * تست‌های تعریفِ پلن (plans.ts) — تابعِ خالص، بدونِ DB/شبکه.
 *
 * تضمین می‌کند مقادیرِ قفل‌شده‌ی CONTEXT (قیمت/اعتبار/سهمیه/کارگر) دست‌نخورده بمانند و
 * نگاشتِ پلن‌های تاریخی (payg/premium) درست کار کند.
 */
import { describe, expect, it } from "vitest";

import {
  PLAN_DEFINITIONS,
  PLAN_LIST,
  PLANS_VERSION,
  applyQuotaFor,
  monthlyCreditFor,
  normalizePlanKey,
  planFor,
  workerIpLimitFor,
} from "@/lib/billing/plans";

describe("PLAN_DEFINITIONS — مقادیرِ قفل‌شده (CONTEXT بخش C)", () => {
  it("Free: ۰ تومان، بدونِ اعتبار، ۱۰۰ اپلای/روز، بدونِ کارگر", () => {
    const p = PLAN_DEFINITIONS.free;
    expect(p.priceToman).toBe(0);
    expect(p.monthlyCreditToman).toBe(0);
    expect(p.applyQuotaPerDay).toBe(100);
    expect(p.workerIpLimit).toBe(0);
    expect(p.directContact).toBe(false);
  });

  it("Pro: ۲۹۹۰۰۰ تومان، +۱۰۰۰۰۰ اعتبار، اپلای نامحدود، بدونِ کارگر", () => {
    const p = PLAN_DEFINITIONS.pro;
    expect(p.priceToman).toBe(299_000);
    expect(p.monthlyCreditToman).toBe(100_000);
    expect(p.applyQuotaPerDay).toBeNull();
    expect(p.workerIpLimit).toBe(0);
    expect(p.directContact).toBe(false);
  });

  it("Max: ۹۹۹۰۰۰ تومان، +۵۰۰۰۰۰ اعتبار، نامحدود، ۱ IPِ کارگر", () => {
    const p = PLAN_DEFINITIONS.max;
    expect(p.priceToman).toBe(999_000);
    expect(p.monthlyCreditToman).toBe(500_000);
    expect(p.applyQuotaPerDay).toBeNull();
    expect(p.workerIpLimit).toBe(1);
    expect(p.directContact).toBe(false);
  });

  it("MaxPlus: ۱۹۹۰۰۰۰ تومان، +۲۰۰۰۰۰۰ اعتبار، نامحدود، ۵ IP، تماسِ مستقیم", () => {
    const p = PLAN_DEFINITIONS.maxplus;
    expect(p.priceToman).toBe(1_990_000);
    expect(p.monthlyCreditToman).toBe(2_000_000);
    expect(p.applyQuotaPerDay).toBeNull();
    expect(p.workerIpLimit).toBe(5);
    expect(p.directContact).toBe(true);
  });

  it("نسخه‌دار است و PLAN_LIST به ترتیبِ قیمت است", () => {
    expect(PLANS_VERSION).toBe(1);
    expect(PLAN_LIST.map((p) => p.key)).toEqual(["free", "pro", "max", "maxplus"]);
    const prices = PLAN_LIST.map((p) => p.priceToman);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });
});

describe("helpers — planFor / workerIpLimitFor / applyQuotaFor / monthlyCreditFor", () => {
  it("کلیدِ فعال را مستقیم برمی‌گرداند", () => {
    expect(planFor("max").key).toBe("max");
    expect(workerIpLimitFor("maxplus")).toBe(5);
    expect(applyQuotaFor("free")).toBe(100);
    expect(monthlyCreditFor("pro")).toBe(100_000);
  });

  it("اپلای نامحدودِ پلن‌های پولی = null", () => {
    expect(applyQuotaFor("pro")).toBeNull();
    expect(applyQuotaFor("max")).toBeNull();
    expect(applyQuotaFor("maxplus")).toBeNull();
  });
});

describe("normalizePlanKey — نگاشتِ پلن‌های تاریخی", () => {
  it("payg → free و premium → pro", () => {
    expect(normalizePlanKey("payg")).toBe("free");
    expect(normalizePlanKey("premium")).toBe("pro");
    expect(planFor("payg").key).toBe("free");
    expect(planFor("premium").key).toBe("pro");
  });

  it("کلیدِ ناشناخته به‌صورتِ دفاعی free می‌شود (هرگز throw)", () => {
    expect(normalizePlanKey("nonsense")).toBe("free");
    expect(planFor("nonsense").key).toBe("free");
  });
});
