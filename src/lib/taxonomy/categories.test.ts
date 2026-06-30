/**
 * تستِ تاکسونومیِ دسته‌بندیِ مشاغل (WF1) — خالص، بدونِ DB.
 */
import { describe, expect, it } from "vitest";

import {
  JOB_CATEGORY_BY_SLUG,
  JOB_CATEGORY_SEED,
  JOB_CATEGORY_SLUGS,
  isValidCategorySlug,
} from "@/lib/taxonomy/categories";

describe("تاکسونومیِ دسته‌بندیِ مشاغل", () => {
  it("دستِ‌کم ۲۵ دسته دارد", () => {
    expect(JOB_CATEGORY_SEED.length).toBeGreaterThanOrEqual(25);
  });

  it("همه‌ی slugها یکتا هستند", () => {
    const unique = new Set(JOB_CATEGORY_SLUGS);
    expect(unique.size).toBe(JOB_CATEGORY_SEED.length);
  });

  it("هر دسته slug (kebab-case)، برچسبِ فارسی و انگلیسی دارد", () => {
    for (const c of JOB_CATEGORY_SEED) {
      expect(c.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(c.labelFa.trim().length).toBeGreaterThan(0);
      expect(c.labelEn.trim().length).toBeGreaterThan(0);
      expect(typeof c.sortOrder).toBe("number");
    }
  });

  it("برخی دسته‌های کلیدیِ بازارِ ایران حاضرند", () => {
    for (const slug of [
      "software-development",
      "finance-accounting",
      "marketing-sales",
      "graphic-ui-design",
      "civil-engineering",
      "healthcare-medical",
      "education-teaching",
    ]) {
      expect(isValidCategorySlug(slug)).toBe(true);
    }
  });

  it("lookupِ slug→دسته کار می‌کند و slugِ نامعتبر را رد می‌کند", () => {
    expect(JOB_CATEGORY_BY_SLUG.get("software-development")?.labelEn).toBe(
      "Software Development",
    );
    expect(isValidCategorySlug("not-a-real-category")).toBe(false);
  });
});
