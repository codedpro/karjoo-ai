/**
 * تست‌های واحدِ `interpretFindJobsResponse` — منطقِ خالصِ نگاشتِ (status × body) به
 * حالتِ UI برای دکمه‌ی «جست‌وجوی مشاغل». هیچ رندر/شبکه‌ای؛ فقط شاخه‌ی تصمیم.
 *
 * تمرکز: هر کدِ وضعیت که اندپوینت می‌تواند برگرداند (۲۰۰ موفق/no_filters، ۴۰۱/۴۰۲/۴۰۳/
 * ۴۲۹/۵۰۳/۴۰۰) + دفاعی‌بودن (فیلدِ ناشناخته نادیده، topupUrl پیش‌فرض روی ۴۰۲).
 */
import { describe, expect, it } from "vitest";

import { interpretFindJobsResponse } from "./find-jobs-button";

describe("interpretFindJobsResponse", () => {
  it("۲۰۰ با enqueued>0 → queued با شمارش‌های درست", () => {
    const out = interpretFindJobsResponse(200, {
      enqueued: 9,
      alreadyQueued: 3,
      ingested: 12,
      skippedByCap: 0,
      aiFilter: false,
    });
    expect(out).toEqual({ kind: "queued", enqueued: 9, alreadyQueued: 3, skippedByCap: 0 });
  });

  it("۲۰۰ با enqueued=0 → none (چیزِ تازه‌ای صف نشد)", () => {
    const out = interpretFindJobsResponse(200, {
      enqueued: 0,
      alreadyQueued: 5,
      skippedByCap: 0,
    });
    expect(out).toEqual({ kind: "none", alreadyQueued: 5, skippedByCap: 0 });
  });

  it("۲۰۰ با reason=no_filters → noFilters و پیامِ سرور حفظ می‌شود", () => {
    const out = interpretFindJobsResponse(200, {
      enqueued: 0,
      reason: "no_filters",
      message: "هنوز فیلتری تنظیم نکرده‌اید.",
    });
    expect(out).toEqual({ kind: "noFilters", message: "هنوز فیلتری تنظیم نکرده‌اید." });
  });

  it("۲۰۰/no_filters بدونِ message → پیامِ پیش‌فرضِ فارسی", () => {
    const out = interpretFindJobsResponse(200, { enqueued: 0, reason: "no_filters" });
    expect(out.kind).toBe("noFilters");
    if (out.kind === "noFilters") expect(out.message.length).toBeGreaterThan(0);
  });

  it("فیلدِ ناشناخته (مثلِ صفحه‌بندیِ آینده) نادیده گرفته می‌شود", () => {
    const out = interpretFindJobsResponse(200, {
      enqueued: 2,
      alreadyQueued: 0,
      skippedByCap: 0,
      nextPage: 3, // فیلدِ ناشناخته — نباید چیزی را بشکند
    });
    expect(out).toEqual({ kind: "queued", enqueued: 2, alreadyQueued: 0, skippedByCap: 0 });
  });

  it("۴۰۱ → auth", () => {
    expect(interpretFindJobsResponse(401, { error: "احراز هویت لازم است" })).toEqual({
      kind: "auth",
    });
  });

  it("۴۰۲ با topupUrl → insufficientBalance و همان url", () => {
    const out = interpretFindJobsResponse(402, {
      error: "موجودی ناکافی",
      topupUrl: "https://1xai.ir/topup",
    });
    expect(out).toEqual({ kind: "insufficientBalance", topupUrl: "https://1xai.ir/topup" });
  });

  it("۴۰۲ بدونِ topupUrl → لینکِ شارژِ پیش‌فرضِ 1xai", () => {
    const out = interpretFindJobsResponse(402, { error: "موجودی ناکافی" });
    expect(out).toEqual({
      kind: "insufficientBalance",
      topupUrl: "https://1xai.ir/topup",
    });
  });

  it("۴۰۳ → planLimited و پیامِ سرور", () => {
    expect(interpretFindJobsResponse(403, { error: "پلنِ شما اجازه نمی‌دهد" })).toEqual({
      kind: "planLimited",
      message: "پلنِ شما اجازه نمی‌دهد",
    });
  });

  it("۴۲۹ با retryAfterSec → rateLimited و مقدار حفظ می‌شود", () => {
    expect(interpretFindJobsResponse(429, { error: "زیاد", retryAfterSec: 42 })).toEqual({
      kind: "rateLimited",
      retryAfterSec: 42,
    });
  });

  it("۵۰۳ → infra", () => {
    expect(interpretFindJobsResponse(503, { error: "svc down" })).toEqual({ kind: "infra" });
  });

  it("۴۰۰ → error با پیامِ سرور", () => {
    expect(interpretFindJobsResponse(400, { error: "validation failed" })).toEqual({
      kind: "error",
      message: "validation failed",
    });
  });

  it("۵۰۰ بدونِ بدنه‌ی معتبر → error با پیامِ null (کامپوننت پیشِ‌فرض می‌گذارد)", () => {
    expect(interpretFindJobsResponse(500, null)).toEqual({ kind: "error", message: null });
  });
});
