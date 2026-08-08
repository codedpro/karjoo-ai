/**
 * تستِ نگاشتِ خالصِ «علاقه‌مندی → ترجیحات» (Track B) — بدونِ DB/شبکه.
 */
import { describe, expect, it } from "vitest";

import { JOB_CATEGORY_BY_SLUG } from "@/lib/taxonomy/categories";
import {
  mergeInterestPreferences,
  selectedCategoriesToPreferences,
} from "@/lib/interests/to-preferences";

describe("selectedCategoriesToPreferences", () => {
  it("slugهای معتبر → categories (همان slug)", () => {
    const { categories } = selectedCategoriesToPreferences([
      "software-development",
      "finance-accounting",
    ]);
    expect(categories).toEqual(["software-development", "finance-accounting"]);
  });

  it("برچسبِ نمایشیِ دسته هرگز به کلیدواژه تبدیل نمی‌شود", () => {
    // برچسب («برنامه‌نویسی و توسعهٔ نرم‌افزار») به‌عنوانِ keyword در جابینجا صفر نتیجه دارد؛
    // هدف‌گیری باید با خودِ دسته انجام شود، نه با نامِ دسته.
    const out = selectedCategoriesToPreferences(["software-development"]) as unknown as Record<string, unknown>;
    const sw = JOB_CATEGORY_BY_SLUG.get("software-development")!;
    expect(out.titles).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(sw.labelFa);
  });

  it("slugِ نامعتبر/ناشناخته بی‌سروصدا حذف می‌شود", () => {
    const { categories } = selectedCategoriesToPreferences([
      "software-development",
      "not-a-real-category",
      "",
    ]);
    expect(categories).toEqual(["software-development"]);
  });

  it("خروجی به ترتیبِ تاکسونومی (sortOrder) پایدار است، نه ترتیبِ ورودی", () => {
    // ورودی عمداً برعکسِ ترتیبِ sortOrder.
    const { categories } = selectedCategoriesToPreferences([
      "finance-accounting", // sortOrder 110
      "software-development", // sortOrder 10
    ]);
    expect(categories).toEqual(["software-development", "finance-accounting"]);
  });

  it("تکراری‌ها یکتا می‌شوند", () => {
    const { categories } = selectedCategoriesToPreferences([
      "data-ai",
      "data-ai",
      "data-ai",
    ]);
    expect(categories).toEqual(["data-ai"]);
  });

  it("ورودیِ خالی → categories خالی", () => {
    expect(selectedCategoriesToPreferences([])).toEqual({ categories: [] });
  });
});

describe("mergeInterestPreferences", () => {
  it("دسته‌ها را در categorySlugs می‌نویسد و کلیدواژه‌های خودِ کاربر را نگه می‌دارد", () => {
    const existing = {
      cities: ["تهران"],
      minSalary: 30_000_000,
      employmentTypes: ["full-time"],
      titles: ["عنوانِ قدیمی"],
      categories: ["stale-slug"],
    };
    const merged = mergeInterestPreferences(existing, ["software-development"]);

    expect(merged.cities).toEqual(["تهران"]);
    expect(merged.minSalary).toBe(30_000_000);
    expect(merged.employmentTypes).toEqual(["full-time"]);
    // کلیدِ واقعیِ فیلتر که buildSearchUrl می‌خواند:
    expect(merged.categorySlugs).toEqual(["software-development"]);
    // کلیدواژه‌های جست‌وجوی خودِ کاربر دست‌نخورده می‌ماند — پیش‌تر با نامِ دسته‌ها بازنویسی
    // می‌شد و جست‌وجو صفر نتیجه می‌داد.
    expect(merged.titles).toEqual(["عنوانِ قدیمی"]);
  });

  it("preferencesِ null/undefined → آبجکتِ تازه بدونِ خطا", () => {
    expect(mergeInterestPreferences(null, ["data-ai"]).categorySlugs).toEqual(["data-ai"]);
    expect(mergeInterestPreferences(undefined, []).categorySlugs).toEqual([]);
  });
});
