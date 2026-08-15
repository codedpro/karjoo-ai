/**
 * تست‌های واحدِ نگاشتِ خالصِ «فیلترهای اپلای» — بدونِ DB.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_APPLY_FILTERS,
  mergeApplyFilters,
  parseApplyFilters,
  toJobPreferences,
} from "@/lib/apply/filters";

describe("parseApplyFilters", () => {
  it("null/غیرشیء → فیلترِ خالی", () => {
    expect(parseApplyFilters(null)).toEqual(EMPTY_APPLY_FILTERS);
    expect(parseApplyFilters(undefined)).toEqual(EMPTY_APPLY_FILTERS);
  });

  it("کلیدهای معتبر را می‌خواند و trim/dedupe می‌کند", () => {
    const f = parseApplyFilters({
      categorySlugs: ["a", " a ", "b", 3],
      cities: ["تهران", "  "],
      jobTypes: ["full"],
      remoteOnly: true,
      minSalary: 20_000_000,
      sort: " published_at_desc ",
      aiFilterEnabled: true,
    });
    expect(f.categorySlugs).toEqual(["a", "b"]);
    expect(f.cities).toEqual(["تهران"]);
    expect(f.jobTypes).toEqual(["full"]);
    expect(f.remoteOnly).toBe(true);
    expect(f.minSalary).toBe(20_000_000);
    expect(f.sort).toBe("published_at_desc");
    expect(f.aiFilterEnabled).toBe(true);
  });

  it("minSalary صفر/منفی و sort خالی → undefined؛ remoteOnly/aiFilter فقط با true", () => {
    const f = parseApplyFilters({ minSalary: 0, sort: "   ", remoteOnly: "yes", aiFilterEnabled: 1 });
    expect(f.minSalary).toBeUndefined();
    expect(f.sort).toBeUndefined();
    expect(f.remoteOnly).toBe(false);
    expect(f.aiFilterEnabled).toBe(false);
  });
});

describe("toJobPreferences", () => {
  it("titles/categorySlugs/cities/… را برای buildSearchUrl می‌سازد", () => {
    const prefs = toJobPreferences({
      titles: ["برنامه‌نویس", "برنامه‌نویس"],
      categorySlugs: ["وب"],
      cities: ["تهران"],
      jobTypes: ["full"],
      remoteOnly: true,
      minSalary: 15_000_000,
      sort: "salary_from_desc",
    });
    expect(prefs.titles).toEqual(["برنامه‌نویس"]);
    expect(prefs.categorySlugs).toEqual(["وب"]);
    expect(prefs.cities).toEqual(["تهران"]);
    expect(prefs.jobTypes).toEqual(["full"]);
    expect(prefs.remoteOnly).toBe(true);
    expect(prefs.minSalary).toBe(15_000_000);
    expect(prefs.sort).toBe("salary_from_desc");
  });

  it("کلیدهای خالی حذف می‌شوند (شیِ ترجیحاتِ کمینه)", () => {
    expect(toJobPreferences({})).toEqual({});
    expect(toJobPreferences(null)).toEqual({});
  });

  it("employmentTypesِ میراث را عبور می‌دهد", () => {
    const prefs = toJobPreferences({ employmentTypes: ["remote"] });
    expect(prefs.employmentTypes).toEqual(["remote"]);
  });
});

describe("mergeApplyFilters", () => {
  it("کلیدهای مدیریت‌شده را بازنویسی و کلیدهای دیگر (titles/categories) را حفظ می‌کند", () => {
    const existing = {
      titles: ["برنامه‌نویس"],
      categories: ["internal-slug"],
      minSalary: 5_000_000,
      categorySlugs: ["old"],
    };
    const merged = mergeApplyFilters(existing, {
      categorySlugs: ["new-a", "new-b"],
      cities: ["تهران"],
      jobTypes: [],
      remoteOnly: true,
      aiFilterEnabled: true,
      paused: false,
    });
    // مشتقاتِ interests دست‌نخورده.
    expect(merged.titles).toEqual(["برنامه‌نویس"]);
    expect(merged.categories).toEqual(["internal-slug"]);
    // مدیریت‌شده‌ها بازنویسی.
    expect(merged.categorySlugs).toEqual(["new-a", "new-b"]);
    expect(merged.cities).toEqual(["تهران"]);
    expect(merged.remoteOnly).toBe(true);
    expect(merged.aiFilterEnabled).toBe(true);
    // minSalary داده نشد (undefined) → حذف شد.
    expect(merged.minSalary).toBeUndefined();
    expect("minSalary" in merged).toBe(false);
  });

  it("minSalary/sortِ معتبر تنظیم و نامعتبر حذف می‌شود", () => {
    const withVals = mergeApplyFilters(
      { minSalary: 1, sort: "x" },
      { ...EMPTY_APPLY_FILTERS, minSalary: 9_000_000, sort: "published_at_desc" },
    );
    expect(withVals.minSalary).toBe(9_000_000);
    expect(withVals.sort).toBe("published_at_desc");

    const cleared = mergeApplyFilters({ minSalary: 9, sort: "x" }, EMPTY_APPLY_FILTERS);
    expect("minSalary" in cleared).toBe(false);
    expect("sort" in cleared).toBe(false);
  });

  it("round-trip: merge سپس parse همان فیلترها را برمی‌گرداند", () => {
    const filters = {
      categorySlugs: ["a"],
      cities: ["تهران"],
      jobTypes: ["full"],
      remoteOnly: true,
      minSalary: 12_000_000,
      sort: "salary_from_desc",
      aiFilterEnabled: true,
      paused: true,
      dailyLimit: 100,
      weeklyLimit: 500,
    };
    expect(parseApplyFilters(mergeApplyFilters(null, filters))).toEqual(filters);
  });
});
