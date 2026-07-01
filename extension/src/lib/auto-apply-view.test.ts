/**
 * auto-apply-view — Persian status/label rendering for the popup tab (pure).
 */
import { describe, it, expect } from "vitest";
import {
  stateLabel,
  thresholdLabel,
  lastRunLabel,
  formatWhen,
} from "@ext/lib/auto-apply-view";
import type { AutoApplyStatus } from "@ext/lib/types";

describe("stateLabel / thresholdLabel", () => {
  it("reflects the ON/OFF toggle", () => {
    expect(stateLabel({ enabled: true, minScore: 0.7 })).toContain("روشن");
    expect(stateLabel({ enabled: false, minScore: 0.7 })).toContain("خاموش");
  });
  it("is BROWSER-scoped (mentions مرورگر, never سرور)", () => {
    // این سطح باید صریحاً «مرورگر» باشد تا با سطحِ سرور (Max/Max+) اشتباه نشود.
    expect(stateLabel({ enabled: true, minScore: 0.7 })).toContain("مرورگر");
    expect(stateLabel({ enabled: false, minScore: 0.7 })).toContain("مرورگر");
    expect(stateLabel({ enabled: true, minScore: 0.7 })).not.toContain("سرور");
  });
  it("formats the threshold as a percentage", () => {
    expect(thresholdLabel({ enabled: true, minScore: 0.7 })).toBe("70٪");
    expect(thresholdLabel({ enabled: true, minScore: 0.82 })).toBe("82٪");
  });
});

describe("lastRunLabel", () => {
  const base = (over: Partial<AutoApplyStatus>): AutoApplyStatus => ({
    ranAt: Date.now(),
    outcome: "applied",
    submitted: 0,
    failed: 0,
    ...over,
  });

  it("handles the null (never-run) case", () => {
    expect(lastRunLabel(null)).toBe("هنوز اجرا نشده");
  });
  it("describes a disabled tick", () => {
    expect(lastRunLabel(base({ outcome: "disabled" }))).toContain("خاموش");
  });
  it("describes a cap-reached tick", () => {
    expect(lastRunLabel(base({ outcome: "quota_reached", submitted: 5 }))).toContain("سقف");
  });
  it("describes an applied tick with counts", () => {
    const l = lastRunLabel(base({ outcome: "applied", submitted: 3, failed: 1 }));
    expect(l).toContain("3");
    expect(l).toContain("1");
  });
});

describe("formatWhen", () => {
  it("renders relative buckets", () => {
    const now = 10_000_000_000;
    expect(formatWhen(now, now)).toBe("همین حالا");
    expect(formatWhen(now - 5 * 60_000, now)).toContain("دقیقه");
    expect(formatWhen(now - 3 * 3_600_000, now)).toContain("ساعت");
    expect(formatWhen(now - 2 * 86_400_000, now)).toContain("روز");
  });
});
