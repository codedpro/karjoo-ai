import { describe, expect, it } from "vitest";

import { computeFilterSignature } from "@/lib/apply/filter-cursor";

describe("computeFilterSignature", () => {
  it("به ترتیب و حروف‌بزرگ/فاصله حساس نیست (پایدار)", () => {
    const a = computeFilterSignature({
      titles: [" Backend ", "frontend"],
      cities: ["تهران", "کرج"],
      categorySlugs: ["software", "it"],
    });
    const b = computeFilterSignature({
      titles: ["frontend", "backend"],
      cities: ["کرج", "تهران"],
      categorySlugs: ["it", "software"],
    });
    expect(a).toBe(b);
  });

  it("با تغییرِ هر میدانِ هدف‌گیری امضا عوض می‌شود", () => {
    const base = computeFilterSignature({ titles: ["x"], cities: ["تهران"] });
    expect(computeFilterSignature({ titles: ["y"], cities: ["تهران"] })).not.toBe(base);
    expect(computeFilterSignature({ titles: ["x"], cities: ["اصفهان"] })).not.toBe(base);
    expect(computeFilterSignature({ titles: ["x"], cities: ["تهران"], remoteOnly: true })).not.toBe(
      base,
    );
    expect(computeFilterSignature({ titles: ["x"], cities: ["تهران"], minSalary: 5 })).not.toBe(
      base,
    );
    expect(computeFilterSignature({ titles: ["x"], cities: ["تهران"], sort: "date" })).not.toBe(
      base,
    );
  });

  it("مقادیرِ خالی/صفر با «تنظیم‌نشده» یکی‌اند (نویزِ بی‌اثر امضا را نمی‌شکند)", () => {
    const a = computeFilterSignature({ titles: ["x"] });
    const b = computeFilterSignature({
      titles: ["x", "  ", ""],
      cities: [],
      minSalary: 0,
      remoteOnly: false,
      sort: "",
    });
    expect(a).toBe(b);
  });
});
