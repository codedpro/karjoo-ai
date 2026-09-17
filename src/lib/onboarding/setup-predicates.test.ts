import { describe, expect, it } from "vitest";

import { EMPTY_APPLY_FILTERS } from "@/lib/apply/filters";
import {
  isBoardConnected,
  isResumeReady,
  isTargetingReady,
  STUB_FULL_NAME,
} from "@/lib/onboarding/setup-predicates";

describe("isResumeReady", () => {
  it("یک فایلِ آپلودشده کافی است", () => {
    expect(isResumeReady(null, 1)).toBe(true);
  });

  it("پروفایلِ استاب (نامِ پیش‌فرض، بدونِ مهارت) رزومه نیست", () => {
    expect(isResumeReady({ fullName: STUB_FULL_NAME, skills: [] }, 0)).toBe(false);
    expect(isResumeReady({ fullName: STUB_FULL_NAME, skills: ["go"] }, 0)).toBe(false);
  });

  it("نامِ واقعی + مهارت = آماده", () => {
    expect(isResumeReady({ fullName: "سارا", skills: ["react"] }, 0)).toBe(true);
    expect(isResumeReady({ fullName: "سارا", skills: [] }, 0)).toBe(false);
    expect(isResumeReady(null, 0)).toBe(false);
  });
});

describe("isTargetingReady", () => {
  it("فیلترهای خالی آماده نیستند", () => {
    expect(isTargetingReady(EMPTY_APPLY_FILTERS)).toBe(false);
  });

  it("فیلترهای سراسریِ قدیمی کافی‌اند", () => {
    expect(isTargetingReady({ ...EMPTY_APPLY_FILTERS, cities: ["تهران"] })).toBe(true);
  });

  it("سایتِ فعال با زمینه‌ی کاری آماده است", () => {
    const filters = {
      ...EMPTY_APPLY_FILTERS,
      boardFilters: {
        ...EMPTY_APPLY_FILTERS.boardFilters,
        jobinja: { ...EMPTY_APPLY_FILTERS.boardFilters.jobinja, enabled: true, categoryKeys: ["web"] },
      },
    };
    expect(isTargetingReady(filters)).toBe(true);
  });

  it("شرط روی سایتِ خاموش حساب نمی‌شود", () => {
    const filters = {
      ...EMPTY_APPLY_FILTERS,
      boardFilters: {
        ...EMPTY_APPLY_FILTERS.boardFilters,
        jobinja: { ...EMPTY_APPLY_FILTERS.boardFilters.jobinja, enabled: false, remoteOnly: true },
      },
    };
    expect(isTargetingReady(filters)).toBe(false);
  });
});

describe("isBoardConnected", () => {
  it("فقط وضعیتِ connected", () => {
    expect(isBoardConnected([{ status: "expired" }])).toBe(false);
    expect(isBoardConnected([{ status: "expired" }, { status: "connected" }])).toBe(true);
    expect(isBoardConnected([])).toBe(false);
  });
});
