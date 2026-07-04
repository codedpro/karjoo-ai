import { describe, expect, it, vi } from "vitest";

import {
  getAiFilterGateState,
  resolveApplyAiFilter,
  type PaidAiEntitlement,
} from "@/lib/apply/ai-gate";

/** استحقاقِ ساختگی — بدونِ DB/کیف‌پول. */
function entitlement(entitled: boolean): PaidAiEntitlement {
  return { entitled, plan: entitled ? "pro" : "free", balanceToman: entitled ? 5000 : 0 };
}

describe("resolveApplyAiFilter — گیتِ مسیرِ اجرا (Track B)", () => {
  it("تاگل خاموش → aiFilter=false و استحقاق اصلاً بررسی نمی‌شود", async () => {
    const checkEntitlement = vi.fn(async () => entitlement(true));
    const out = await resolveApplyAiFilter("u1", {
      readEnabled: async () => false,
      checkEntitlement,
    });
    expect(out).toEqual({ aiFilter: false, enabled: false, entitled: false });
    // مسیرِ پایه هرگز کیف‌پول را لمس نمی‌کند.
    expect(checkEntitlement).not.toHaveBeenCalled();
  });

  it("تاگل روشن + واجدِ استحقاق → aiFilter=true", async () => {
    const out = await resolveApplyAiFilter("u1", {
      readEnabled: async () => true,
      checkEntitlement: async () => entitlement(true),
    });
    expect(out).toEqual({ aiFilter: true, enabled: true, entitled: true });
  });

  it("تاگل روشن ولی بدونِ استحقاق → aiFilter=false (فیلترمودِ همه‌ی شغل‌ها، بدونِ خطا)", async () => {
    const out = await resolveApplyAiFilter("u1", {
      readEnabled: async () => true,
      checkEntitlement: async () => entitlement(false),
    });
    expect(out).toEqual({ aiFilter: false, enabled: true, entitled: false });
  });
});

describe("getAiFilterGateState — وضعیتِ UI", () => {
  it("همیشه هم تاگل و هم استحقاق را می‌خواند (UI به هر دو نیاز دارد)", async () => {
    const readEnabled = vi.fn(async () => false);
    const checkEntitlement = vi.fn(async () => entitlement(true));
    const state = await getAiFilterGateState("u1", { readEnabled, checkEntitlement });
    expect(state).toEqual({
      enabled: false,
      entitled: true,
      aiFilter: false,
      plan: "pro",
      balanceToman: 5000,
    });
    // برخلافِ resolve، حتی وقتی تاگل خاموش است استحقاق برای UI سنجیده می‌شود.
    expect(checkEntitlement).toHaveBeenCalledOnce();
  });

  it("aiFilter مؤثر فقط وقتی هم روشن است هم واجدِ استحقاق", async () => {
    const state = await getAiFilterGateState("u1", {
      readEnabled: async () => true,
      checkEntitlement: async () => entitlement(true),
    });
    expect(state.aiFilter).toBe(true);

    const blocked = await getAiFilterGateState("u1", {
      readEnabled: async () => true,
      checkEntitlement: async () => entitlement(false),
    });
    expect(blocked.aiFilter).toBe(false);
    expect(blocked.enabled).toBe(true);
    expect(blocked.entitled).toBe(false);
  });
});
