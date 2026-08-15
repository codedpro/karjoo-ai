/**
 * تست‌های واحدِ قراردادِ فرمِ «فیلترهای اپلای» (Track A) — بدونِ DB/شبکه.
 *
 * مهم‌ترین تست: «آینه‌ی» URLِ پیش‌نمایش (buildJobinjaPreviewUrl) باید بیت‌به‌بیت با
 * سازنده‌ی canonicalِ سرور (buildSearchUrl صفحه‌ی ۱، بدونِ titles) یکی باشد؛ این تضمین
 * می‌کند پیش‌نمایشِ زنده‌ی کلاینت با چیزی که واقعاً اپلای می‌شود منطبق بماند و اگر روزی
 * قراردادِ پارامترهای جابینجا در کانکتور عوض شد، این تست بشکند (نگهبانِ drift).
 */
import { describe, expect, it } from "vitest";

import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import {
  applyFiltersInputSchema,
  buildJobinjaPreviewUrl,
  DEFAULT_SORT,
  JOB_TYPE_VALUES,
  SORT_VALUES,
  type PreviewFilters,
} from "@/lib/apply/apply-filters-form";

describe("buildJobinjaPreviewUrl آینه‌ی buildSearchUrl است", () => {
  const cases: PreviewFilters[] = [
    { categorySlugs: [], cities: [], jobTypes: [], remoteOnly: false },
    {
      categorySlugs: ["وب،‌-برنامه‌نویسی-و-نرم‌افزار", "طراحی"],
      cities: ["تهران", "اصفهان"],
      jobTypes: ["is_fulltime", "is_parttime"],
      remoteOnly: true,
      minSalary: 15_000_000,
      sort: "salary_from_desc",
    },
    { categorySlugs: ["مالی-و-حسابداری"], cities: [], jobTypes: [], remoteOnly: false, sort: "published_at_desc" },
    { categorySlugs: [], cities: ["مشهد"], jobTypes: ["is_parttime"], remoteOnly: false, minSalary: 8_000_000 },
  ];

  it.each(cases.map((c, i) => [i, c] as const))(
    "مورد %#: خروجی با buildSearchUrl صفحه‌ی ۱ یکی است",
    (_i, filters) => {
      const canonical = buildSearchUrl(
        {
          ...(filters.cities.length ? { cities: filters.cities } : {}),
          ...(filters.categorySlugs.length ? { categorySlugs: filters.categorySlugs } : {}),
          ...(filters.jobTypes.length ? { jobTypes: filters.jobTypes } : {}),
          ...(filters.remoteOnly ? { remoteOnly: true } : {}),
          ...(filters.minSalary ? { minSalary: filters.minSalary } : {}),
          ...(filters.sort ? { sort: filters.sort } : {}),
        },
        1,
      );
      expect(buildJobinjaPreviewUrl(filters)).toBe(canonical);
    },
  );

  it("پایه‌ی درست و پارامترهای موردِانتظار را دارد", () => {
    const url = new URL(
      buildJobinjaPreviewUrl({
        categorySlugs: ["طراحی"],
        cities: ["تهران"],
        jobTypes: ["is_fulltime"],
        remoteOnly: true,
        minSalary: 20_000_000,
        sort: "salary_from_desc",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://jobinja.ir/jobs");
    expect(url.searchParams.getAll("filters[job_categories][]")).toEqual(["طراحی"]);
    expect(url.searchParams.getAll("filters[locations][]")).toEqual(["تهران"]);
    expect(url.searchParams.getAll("filters[job_types][]")).toEqual(["is_fulltime"]);
    expect(url.searchParams.get("filters[remote]")).toBe("1");
    expect(url.searchParams.get("filters[sal_min]")).toBe("20000000");
    expect(url.searchParams.get("sort")).toBe("salary_from_desc");
  });
});

describe("applyFiltersInputSchema", () => {
  it("ورودیِ معتبر را با پیش‌فرض‌ها می‌پذیرد", () => {
    const parsed = applyFiltersInputSchema.parse({});
    expect(parsed).toEqual({
      categorySlugs: [],
      cities: [],
      jobTypes: [],
      remoteOnly: false,
      paused: false,
    });
  });

  it("همه‌ی فیلدها را نگه می‌دارد و trim می‌کند", () => {
    const parsed = applyFiltersInputSchema.parse({
      categorySlugs: [" طراحی "],
      cities: [" تهران "],
      jobTypes: ["is_fulltime"],
      remoteOnly: true,
      minSalary: 12_000_000,
      sort: "published_at_desc",
    });
    expect(parsed.categorySlugs).toEqual(["طراحی"]);
    expect(parsed.cities).toEqual(["تهران"]);
    expect(parsed.jobTypes).toEqual(["is_fulltime"]);
    expect(parsed.remoteOnly).toBe(true);
    expect(parsed.minSalary).toBe(12_000_000);
    expect(parsed.sort).toBe("published_at_desc");
  });

  it("نوعِ همکاریِ ناشناخته و sortِ نامعتبر و حقوقِ منفی را رد می‌کند", () => {
    expect(applyFiltersInputSchema.safeParse({ jobTypes: ["is_freelance"] }).success).toBe(false);
    expect(applyFiltersInputSchema.safeParse({ sort: "bogus" }).success).toBe(false);
    expect(applyFiltersInputSchema.safeParse({ minSalary: -5 }).success).toBe(false);
  });

  it("مقادیرِ ثابت با فرمِ زنده‌ی جابینجا هم‌خوان‌اند", () => {
    expect(JOB_TYPE_VALUES).toEqual(["is_fulltime", "is_parttime"]);
    expect(SORT_VALUES).toContain(DEFAULT_SORT);
    expect(SORT_VALUES).toEqual(["relevance_desc", "published_at_desc", "salary_from_desc"]);
  });
});
