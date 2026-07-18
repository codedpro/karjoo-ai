/**
 * تست‌های منطقِ خالصِ قیفِ اپلای (funnel → عرضِ نوار) — بدونِ I/O، بدونِ DB.
 */
import { describe, expect, it } from "vitest";

import type { ApplicationFunnel } from "@/lib/apply/boards/jobinja-read";
import { buildFunnelSegments, CATEGORY_META, FUNNEL_ORDER } from "./funnel";

/** سازنده‌ی قیفِ آزمایشی — فیلدهای نامشخص صفر. */
function funnel(p: Partial<ApplicationFunnel>): ApplicationFunnel {
  return { total: 0, pending: 0, review: 0, interview: 0, rejected: 0, other: 0, ...p };
}

describe("buildFunnelSegments", () => {
  it("قیفِ خالی → پنج قطعه، همه با عرضِ صفر و بدونِ NaN", () => {
    const segs = buildFunnelSegments(funnel({}));
    expect(segs).toHaveLength(FUNNEL_ORDER.length);
    for (const s of segs) {
      expect(s.pct).toBe(0);
      expect(Number.isNaN(s.pct)).toBe(false);
    }
  });

  it("عرضِ هر دسته = شمارش ÷ کل ×۱۰۰", () => {
    const segs = buildFunnelSegments(
      funnel({ total: 10, pending: 5, review: 3, interview: 2 }),
    );
    const pctByKey = Object.fromEntries(segs.map((s) => [s.key, s.pct]));
    expect(pctByKey.pending).toBe(50);
    expect(pctByKey.review).toBe(30);
    expect(pctByKey.interview).toBe(20);
    expect(pctByKey.rejected).toBe(0);
  });

  it("شمارشِ خامِ هر دسته دست‌نخورده در قطعه می‌آید", () => {
    const segs = buildFunnelSegments(funnel({ total: 4, interview: 1, rejected: 3 }));
    const countByKey = Object.fromEntries(segs.map((s) => [s.key, s.count]));
    expect(countByKey.interview).toBe(1);
    expect(countByKey.rejected).toBe(3);
  });

  it("جمعِ عرض‌ها از ۱۰۰ فراتر نمی‌رود و هیچ عرضی منفی نیست", () => {
    const segs = buildFunnelSegments(
      funnel({ total: 7, pending: 2, review: 2, interview: 1, rejected: 1, other: 1 }),
    );
    const sum = segs.reduce((acc, s) => acc + s.pct, 0);
    expect(sum).toBeLessThanOrEqual(100.01);
    for (const s of segs) expect(s.pct).toBeGreaterThanOrEqual(0);
  });

  it("ترتیبِ قطعات با FUNNEL_ORDER یکی‌ست و برچسب/لحن از متادیتا می‌آید", () => {
    const segs = buildFunnelSegments(funnel({ total: 1, interview: 1 }));
    expect(segs.map((s) => s.key)).toEqual(FUNNEL_ORDER);
    const interview = segs.find((s) => s.key === "interview")!;
    expect(interview.label).toBe(CATEGORY_META.interview.label);
    expect(interview.tone).toBe("green");
  });
});
