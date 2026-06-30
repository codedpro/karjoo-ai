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
  it("slugهای معتبر → categories (همان slug) + titles (برچسبِ فا/انگ)", () => {
    const { titles, categories } = selectedCategoriesToPreferences([
      "software-development",
      "finance-accounting",
    ]);

    expect(categories).toEqual(["software-development", "finance-accounting"]);

    const sw = JOB_CATEGORY_BY_SLUG.get("software-development")!;
    const fin = JOB_CATEGORY_BY_SLUG.get("finance-accounting")!;
    expect(titles).toContain(sw.labelFa);
    expect(titles).toContain(sw.labelEn);
    expect(titles).toContain(fin.labelFa);
    expect(titles).toContain(fin.labelEn);
    // هر دسته دقیقاً دو عنوان (فا + انگ).
    expect(titles).toHaveLength(4);
  });

  it("slugِ نامعتبر/ناشناخته بی‌سروصدا حذف می‌شود", () => {
    const { categories, titles } = selectedCategoriesToPreferences([
      "software-development",
      "not-a-real-category",
      "",
    ]);
    expect(categories).toEqual(["software-development"]);
    expect(titles).toHaveLength(2);
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

  it("ورودیِ خالی → titles/categories خالی", () => {
    expect(selectedCategoriesToPreferences([])).toEqual({
      titles: [],
      categories: [],
    });
  });
});

describe("mergeInterestPreferences", () => {
  it("titles/categories را بازنویسی می‌کند ولی فیلدهای دیگر را نگه می‌دارد", () => {
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
    expect(merged.categories).toEqual(["software-development"]);
    expect(merged.titles).not.toContain("عنوانِ قدیمی");
  });

  it("preferencesِ null/undefined → آبجکتِ تازه بدونِ خطا", () => {
    expect(mergeInterestPreferences(null, ["data-ai"]).categories).toEqual(["data-ai"]);
    expect(mergeInterestPreferences(undefined, []).categories).toEqual([]);
  });
});
