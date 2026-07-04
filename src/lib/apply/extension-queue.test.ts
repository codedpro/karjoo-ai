/**
 * تستِ واحدِ هِلپرِ خالصِ تفکیکِ فیلترمود از AIمود در صفِ افزونه.
 */
import { describe, expect, it } from "vitest";

import { isFilterModeTask } from "@/lib/apply/extension-queue";

describe("isFilterModeTask", () => {
  it("payload با mode='filter' → true", () => {
    expect(isFilterModeTask({ mode: "filter", board: "jobinja" })).toBe(true);
  });

  it("mode='ai' یا بدونِ mode → false (گیتِ آستانه اعمال می‌شود)", () => {
    expect(isFilterModeTask({ mode: "ai" })).toBe(false);
    expect(isFilterModeTask({ board: "jobinja" })).toBe(false);
    expect(isFilterModeTask({})).toBe(false);
  });

  it("مقادیرِ غیرشیء → false", () => {
    expect(isFilterModeTask(null)).toBe(false);
    expect(isFilterModeTask(undefined)).toBe(false);
    expect(isFilterModeTask("filter")).toBe(false);
    expect(isFilterModeTask(42)).toBe(false);
  });
});
