/**
 * جابه‌جاییِ گارد از «ساختِ رزومه» به «انتخابِ شغل».
 *
 * ادعای اصلی: وقتی کاربر خودش آگهی را انتخاب می‌کند (کلیکِ اپلای، یا عبور از فیلترهای
 * خودش + تطبیق‌دهنده)، همان انتخاب اعلامِ اوست که واجدِ این شغل است — و گاردِ مهارت
 * نباید جلوی خواسته‌های همان آگهی بایستد. بدونِ چنین انتخابی، گاردِ کامل سرِ جایش است.
 */
import { describe, expect, it } from "vitest";

import { __testables } from "@/lib/resume/custom-resume-service";

const { keepOnlyRealSkills } = __testables;

/** رزومه‌ی یک برنامه‌نویسِ وب — هیچ نشانی از سئو یا فروش ندارد. */
const EVIDENCE = "مهارت‌ها: React، Next.js، TypeScript، PostgreSQL، Docker";

describe("گارد بدونِ انتخابِ کاربر (source = none)", () => {
  it("مهارتِ بی‌شاهد حذف می‌شود", () => {
    expect(keepOnlyRealSkills(["SEO", "Keyword Research"], EVIDENCE)).toEqual([]);
  });

  it("مهارتِ دارای شاهد می‌ماند", () => {
    expect(keepOnlyRealSkills(["React", "Docker"], EVIDENCE)).toEqual(["React", "Docker"]);
  });
});

describe("گارد وقتی کاربر خودش آگهی را انتخاب کرده", () => {
  /** خواسته‌های همان آگهیِ سئو که کاربر رویش کلیکِ اپلای زده. */
  const JD_TECH = ["SEO", "Technical SEO", "Google Analytics", "Keyword Research"];

  it("خواسته‌های همین آگهی پذیرفته می‌شوند", () => {
    expect(keepOnlyRealSkills(["SEO", "Google Analytics"], EVIDENCE, JD_TECH)).toEqual([
      "SEO",
      "Google Analytics",
    ]);
  });

  it("مهارتِ بی‌ربط که آگهی هم نخواسته، همچنان حذف می‌شود", () => {
    // آگهیِ سئو است؛ «Flutter» نه شاهد دارد نه آگهی خواسته → حذف.
    expect(keepOnlyRealSkills(["SEO", "Flutter"], EVIDENCE, JD_TECH)).toEqual(["SEO"]);
  });

  it("شاهدِ واقعی هم مثلِ قبل می‌ماند", () => {
    expect(keepOnlyRealSkills(["React", "SEO"], EVIDENCE, JD_TECH)).toEqual(["React", "SEO"]);
  });

  it("نگارشِ متفاوتِ خواسته‌ی آگهی هم پذیرفته می‌شود", () => {
    expect(keepOnlyRealSkills(["technical seo"], EVIDENCE, JD_TECH)).toEqual(["technical seo"]);
  });

  it("تکراری‌ها یک‌بار می‌آیند", () => {
    expect(keepOnlyRealSkills(["SEO", "seo", "S E O"], EVIDENCE, JD_TECH)).toEqual(["SEO"]);
  });
});
