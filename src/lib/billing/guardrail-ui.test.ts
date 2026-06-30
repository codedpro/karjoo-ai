/**
 * تستِ خالصِ نگاشت‌گرهای گاردریلِ UI (WF3 Track B) — بدونِ DB/شبکه.
 *
 * پوشش: تشخیصِ نگه‌داری (۵۰۳ + code)، پارسِ /api/ai-status، نمای سهمیه‌ی اپلای،
 * تشخیصِ ۴۲۹ سقف، و قالب‌بندیِ «X / ۱۰۰ درخواست امروز» (با ارقامِ فارسی).
 */
import { describe, expect, it } from "vitest";

import {
  AI_MAINTENANCE_MANUAL_MESSAGE,
  AI_MAINTENANCE_MESSAGE,
  AI_STATUS_AVAILABLE,
  APPLY_QUOTA_MESSAGE,
  buildApplyQuotaView,
  detectApplyQuotaExceeded,
  detectMaintenance,
  formatApplyQuota,
  maintenanceMessage,
  normalizeMaintenanceReason,
  parseAiStatus,
} from "./guardrail-ui";

describe("detectMaintenance", () => {
  it("۵۰۳ با code=ai_maintenance → حالتِ نگه‌داری با علتِ cap", () => {
    const s = detectMaintenance(503, { error: "x", code: "ai_maintenance", reason: "cap" });
    expect(s).toEqual({ maintenance: true, reason: "cap" });
  });

  it("علتِ manual حفظ می‌شود", () => {
    const s = detectMaintenance(503, { code: "ai_maintenance", reason: "manual" });
    expect(s).toEqual({ maintenance: true, reason: "manual" });
  });

  it("علتِ ناشناخته → cap (محتاطانه)", () => {
    const s = detectMaintenance(503, { code: "ai_maintenance", reason: "weird" });
    expect(s).toEqual({ maintenance: true, reason: "cap" });
  });

  it("۵۰۳ بدونِ کدِ ai_maintenance (مثلاً گیت‌وی پیکربندی‌نشده) → null", () => {
    expect(detectMaintenance(503, { error: "not configured" })).toBeNull();
    expect(detectMaintenance(503, null)).toBeNull();
  });

  it("کدهای دیگر (۲۰۰/۴۰۲/۴۲۹) → null", () => {
    expect(detectMaintenance(200, { code: "ai_maintenance" })).toBeNull();
    expect(detectMaintenance(402, { code: "ai_maintenance" })).toBeNull();
    expect(detectMaintenance(429, { code: "ai_maintenance" })).toBeNull();
  });
});

describe("normalizeMaintenanceReason / maintenanceMessage", () => {
  it("manual همان manual، بقیه cap", () => {
    expect(normalizeMaintenanceReason("manual")).toBe("manual");
    expect(normalizeMaintenanceReason("cap")).toBe("cap");
    expect(normalizeMaintenanceReason(undefined)).toBe("cap");
    expect(normalizeMaintenanceReason(123)).toBe("cap");
  });

  it("پیامِ متناسب با علت", () => {
    expect(maintenanceMessage("manual")).toBe(AI_MAINTENANCE_MANUAL_MESSAGE);
    expect(maintenanceMessage("cap")).toBe(AI_MAINTENANCE_MESSAGE);
    expect(maintenanceMessage(null)).toBe(AI_MAINTENANCE_MESSAGE);
  });
});

describe("parseAiStatus", () => {
  it("بدنه‌ی نگه‌داری → maintenance=true با علت", () => {
    expect(parseAiStatus({ maintenance: true, reason: "manual" })).toEqual({
      maintenance: true,
      reason: "manual",
    });
  });

  it("بدنه‌ی در دسترس → AI_STATUS_AVAILABLE", () => {
    expect(parseAiStatus({ maintenance: false, reason: null })).toEqual(AI_STATUS_AVAILABLE);
  });

  it("بدنه‌ی بدشکل/null → در دسترس (fail-open برای نمایش)", () => {
    expect(parseAiStatus(null)).toEqual(AI_STATUS_AVAILABLE);
    expect(parseAiStatus("nope")).toEqual(AI_STATUS_AVAILABLE);
    expect(parseAiStatus({})).toEqual(AI_STATUS_AVAILABLE);
  });
});

describe("buildApplyQuotaView", () => {
  it("سقف‌دار (free): باقی‌مانده و reached درست", () => {
    expect(buildApplyQuotaView(3, 100)).toEqual({
      limit: 100,
      usedToday: 3,
      remaining: 97,
      reached: false,
    });
    expect(buildApplyQuotaView(100, 100)).toEqual({
      limit: 100,
      usedToday: 100,
      remaining: 0,
      reached: true,
    });
    // مصرفِ بیش از سقف → باقی‌مانده هرگز منفی نمی‌شود.
    expect(buildApplyQuotaView(150, 100).remaining).toBe(0);
    expect(buildApplyQuotaView(150, 100).reached).toBe(true);
  });

  it("نامحدود (limit=null) → بدونِ سقف/باقی‌مانده، reached=false", () => {
    expect(buildApplyQuotaView(42, null)).toEqual({
      limit: null,
      usedToday: 42,
      remaining: null,
      reached: false,
    });
  });

  it("ورودیِ نامعتبر usedToday → ۰ و کف‌گیری", () => {
    expect(buildApplyQuotaView(-5, 100).usedToday).toBe(0);
    expect(buildApplyQuotaView(3.9, 100).usedToday).toBe(3);
  });
});

describe("detectApplyQuotaExceeded", () => {
  it("۴۲۹ با code=apply_quota_exceeded → نمای سقفِ پرشده با اعداد", () => {
    const v = detectApplyQuotaExceeded(429, {
      error: APPLY_QUOTA_MESSAGE,
      code: "apply_quota_exceeded",
      usedToday: 100,
      limit: 100,
    });
    expect(v).toEqual({ limit: 100, usedToday: 100, remaining: 0, reached: true });
  });

  it("۴۲۹ بدونِ اعداد → پیش‌فرضِ ۱۰۰/۱۰۰", () => {
    const v = detectApplyQuotaExceeded(429, { code: "apply_quota_exceeded" });
    expect(v).toEqual({ limit: 100, usedToday: 100, remaining: 0, reached: true });
  });

  it("کد یا وضعیتِ نامرتبط → null", () => {
    expect(detectApplyQuotaExceeded(429, { code: "other" })).toBeNull();
    expect(detectApplyQuotaExceeded(200, { code: "apply_quota_exceeded" })).toBeNull();
    expect(detectApplyQuotaExceeded(429, null)).toBeNull();
  });
});

describe("formatApplyQuota", () => {
  it("«X / ۱۰۰ درخواست امروز» با ارقامِ فارسی", () => {
    expect(formatApplyQuota(buildApplyQuotaView(3, 100))).toBe("۳ / ۱۰۰ درخواست امروز");
    expect(formatApplyQuota(buildApplyQuotaView(0, 100))).toBe("۰ / ۱۰۰ درخواست امروز");
    expect(formatApplyQuota(buildApplyQuotaView(100, 100))).toBe("۱۰۰ / ۱۰۰ درخواست امروز");
  });

  it("نامحدود → «اپلای نامحدود»", () => {
    expect(formatApplyQuota(buildApplyQuotaView(5, null))).toBe("اپلای نامحدود");
  });
});
