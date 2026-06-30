/**
 * تست‌های برچسب‌ها/کمک‌کننده‌های نمایشیِ اپلای خودکار (Track A) — خالص، بدونِ I/O.
 */
import { describe, expect, it } from "vitest";

import {
  applyUsageLabel,
  applyUsagePct,
  autoApplyEventLabel,
  boardLabel,
} from "./auto-apply-labels";

describe("autoApplyEventLabel", () => {
  it("هر نوعِ رویدادِ شناخته‌شده برچسب/لحن/آیکن دارد", () => {
    for (const t of [
      "auto_apply_enabled",
      "auto_apply_disabled",
      "auto_apply_attempted",
      "auto_apply_skipped",
    ] as const) {
      const meta = autoApplyEventLabel(t);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });

  it("نوعِ ناشناخته → fallbackِ امن (همان کلید با لحنِ خنثی)", () => {
    const meta = autoApplyEventLabel("something_else");
    expect(meta.label).toBe("something_else");
    expect(meta.tone).toBe("muted");
  });
});

describe("boardLabel", () => {
  it("سایت‌های شناخته‌شده‌ی مشترک را فارسی می‌کند", () => {
    expect(boardLabel("jobinja")).toBe("جابینجا");
    expect(boardLabel("jobvision")).toBe("جاب‌ویژن");
    expect(boardLabel("e-estekhdam")).toBe("ای‌استخدام");
  });

  it("ایران‌تلنت (نبود در برچسب‌های مشترک) را با fallbackِ محلی پوشش می‌دهد", () => {
    expect(boardLabel("irantalent")).toBe("ایران‌تلنت");
  });

  it("سایتِ کاملاً ناشناخته → خودِ کلید", () => {
    expect(boardLabel("unknown-board")).toBe("unknown-board");
  });
});

describe("applyUsageLabel", () => {
  it("سقف‌دار → «X از Y اپلای امروز»", () => {
    expect(applyUsageLabel(3, 100)).toBe("3 از 100 اپلای امروز");
  });

  it("نامحدود (limit=null) → «بدونِ سقف»", () => {
    expect(applyUsageLabel(12, null)).toContain("بدونِ سقف");
  });
});

describe("applyUsagePct", () => {
  it("درصدِ صحیحِ مصرف را می‌دهد", () => {
    expect(applyUsagePct(50, 100)).toBe(50);
    expect(applyUsagePct(3, 100)).toBe(3);
  });

  it("از ۱۰۰ فراتر نمی‌رود (clamp)", () => {
    expect(applyUsagePct(150, 100)).toBe(100);
  });

  it("نامحدود/سقفِ صفر → ۰ (نوارِ پیشرفت معنا ندارد)", () => {
    expect(applyUsagePct(5, null)).toBe(0);
    expect(applyUsagePct(5, 0)).toBe(0);
  });
});
