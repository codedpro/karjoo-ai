import { describe, expect, it } from "vitest";

import { deriveListingAttributes, normalizeCity } from "@/lib/apply/listing-attributes";
import { isCategorySlug } from "@/lib/apply/job-filter-options";

const cat = (title: string, description?: string) => deriveListingAttributes({ title, description }).category;

describe("deriveListingAttributes — category", () => {
  it("places real titles from every board in one vocabulary", () => {
    expect(cat("برنامه‌نویس ارشد React")).toBe("software-development");
    expect(cat("Senior Backend Developer (Golang)")).toBe("software-development");
    expect(cat("کارشناس حسابداری")).toBe("finance-accounting");
    expect(cat("کارشناس فروش تلفنی")).toBe("marketing-sales");
    expect(cat("کارشناس منابع انسانی")).toBe("human-resources");
    expect(cat("طراح گرافیک")).toBe("graphic-ui-design");
  });

  it("tolerates Persian suffixes — «تولید محتوای» is content, not manufacturing", () => {
    expect(cat("کارشناس تولید محتوای اینستاگرام")).toBe("content-translation");
    expect(cat("دستیار دندانپزشک")).toBe("healthcare-medical");
  });

  it("puts the specific role before the generic «مدیر»", () => {
    expect(cat("مدیر محصول")).toBe("product-management");
    expect(cat("مدیر فروش")).toBe("marketing-sales");
    expect(cat("مدیر داخلی")).toBe("management-business");
  });

  it("reads the category from the title only — a CRM mention in the ad is not a job", () => {
    expect(cat("کارشناس فروش", "آشنایی با CRM و نرم افزار حسابداری")).toBe("marketing-sales");
  });

  it("keeps Latin keywords exact: «item» is not IT", () => {
    expect(cat("Item Manager")).toBe("management-business");
  });

  it("leaves what it cannot place unknown", () => {
    expect(cat("نیروی خدماتی")).toBeNull();
  });

  it("only ever returns slugs the filter knows", () => {
    for (const title of ["برنامه نویس", "حسابدار", "مدیر", "راننده", "پرستار", "SEO Specialist"]) {
      const slug = cat(title);
      expect(slug === null || isCategorySlug(slug)).toBe(true);
    }
  });
});

describe("deriveListingAttributes — type and remote", () => {
  it("reads the employment type from the title and the description", () => {
    expect(deriveListingAttributes({ title: "کارآموز فرانت‌اند" }).employmentType).toBe("internship");
    expect(deriveListingAttributes({ title: "حسابدار", description: "همکاری به صورت پاره وقت" }).employmentType).toBe(
      "part_time",
    );
    expect(deriveListingAttributes({ title: "Full-time Designer" }).employmentType).toBe("full_time");
    expect(deriveListingAttributes({ title: "حسابدار" }).employmentType).toBeNull();
  });

  it("detects remote in the text or the city field", () => {
    expect(deriveListingAttributes({ title: "برنامه نویس (دورکاری)" }).remote).toBe(true);
    expect(deriveListingAttributes({ title: "Developer", city: "دورکاری" }).remote).toBe(true);
    expect(deriveListingAttributes({ title: "برنامه نویس", city: "تهران" }).remote).toBe(false);
  });
});

describe("normalizeCity", () => {
  it("one clean Persian name, whatever the board wrote", () => {
    expect(normalizeCity("تهران، تهران")).toBe("تهران");
    expect(normalizeCity("خراسان رضوی، مشهد")).toBe("مشهد");
    expect(normalizeCity("استان اصفهان")).toBe("اصفهان");
    expect(normalizeCity("Tehran")).toBe("تهران");
    expect(normalizeCity("شيراز")).toBe("شیراز");
  });

  it("resolves the formats each board really uses", () => {
    expect(normalizeCity("تهران، ورامین")).toBe("ورامین"); // Jobinja: province, city
    expect(normalizeCity("گیلان، فومن")).toBe("فومن"); // …a town we do not list
    expect(normalizeCity("اصفهان، منطقه ۵، سپاهان‌شهر")).toBe("اصفهان"); // e-estekhdam
    expect(normalizeCity("منطقه ۶، آرژانتین")).toBe("تهران"); // a bare Tehran district
    expect(normalizeCity("سعادت آباد")).toBe("تهران"); // JobVision: a neighbourhood
    expect(normalizeCity("مقدس اردبیلی- زعفرانیه")).toBe("تهران");
    expect(normalizeCity("شهرک صنعتی توس")).toBe("مشهد");
    expect(normalizeCity("شهر قدس")).toBe("قدس");
    expect(normalizeCity("قائم شهر")).toBe("قائم‌شهر");
    expect(normalizeCity("کمال شهر")).toBe("کمال‌شهر");
    expect(normalizeCity("یوسف اباد")).toBe("تهران");
  });

  it("drops what cannot be shown in a Persian list", () => {
    expect(normalizeCity("البرز")).toBeNull(); // a province, not a city
    expect(normalizeCity("محله‌ای ناشناخته")).toBeNull();
    expect(normalizeCity("Dubai")).toBeNull();
    expect(normalizeCity("دورکاری")).toBeNull();
    expect(normalizeCity("  ")).toBeNull();
    expect(normalizeCity(null)).toBeNull();
  });
});
