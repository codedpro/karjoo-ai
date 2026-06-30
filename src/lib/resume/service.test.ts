/**
 * تست‌های منطقِ خالصِ سرویسِ رزومه (merge) — بدونِ DB.
 *
 * تمرکز: merge محتاطانه‌ی فیلدهای parsed روی پروفایلِ موجود، تا داده‌ی قبلیِ کاربر
 * بی‌خود پاک نشود و مهارت‌ها یکتا ادغام شوند.
 */
import { describe, expect, it } from "vitest";

import { mergeProfileFields, mergeSkills } from "@/lib/resume/service";
import type { ParsedResume } from "@/lib/resume/schema";

/** ساختِ یک ParsedResume کمینه با مقادیرِ دلخواه. */
function parsed(partial: Partial<ParsedResume> = {}): ParsedResume {
  return {
    skills: [],
    experience: [],
    education: [],
    ...partial,
  } as ParsedResume;
}

/** ساختِ یک ردیفِ پروفایلِ موجودِ کمینه. */
function existingProfile(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    userId: "u1",
    fullName: "نام قبلی",
    headline: "عنوان قبلی",
    skills: ["Git"],
    yearsExperience: 2,
    city: "اصفهان",
    resumeText: null,
    preferences: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as never;
}

describe("mergeSkills", () => {
  it("یکتا و trim می‌کند و ترتیب (موجود سپس تازه) را حفظ می‌کند", () => {
    expect(mergeSkills(["Git", " React "], ["react", "Docker", "git"])).toEqual([
      "Git",
      "React",
      "Docker",
    ]);
  });

  it("رشته‌های خالی را حذف می‌کند", () => {
    expect(mergeSkills([" "], ["", "SQL"])).toEqual(["SQL"]);
  });

  it("سقفِ ۵۰ مهارت را رعایت می‌کند", () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
    expect(mergeSkills([], many)).toHaveLength(50);
  });
});

describe("mergeProfileFields", () => {
  it("روی پروفایلِ موجود، فقط فیلدهایی که AI داده را جایگزین می‌کند", () => {
    const out = mergeProfileFields(
      existingProfile(),
      parsed({ headline: "عنوان جدید", skills: ["React"] }),
    );
    // headline از AI، city/yearsExperience از پروفایلِ قبلی.
    expect(out.headline).toBe("عنوان جدید");
    expect(out.city).toBe("اصفهان");
    expect(out.yearsExperience).toBe(2);
    expect(out.skills).toEqual(["Git", "React"]);
    // نامِ AI نبود → نامِ قبلی حفظ می‌شود.
    expect(out.fullName).toBe("نام قبلی");
  });

  it("بدونِ پروفایلِ قبلی و بدونِ نامِ AI، نامِ پیش‌فرضِ امن می‌گذارد", () => {
    const out = mergeProfileFields(null, parsed({ skills: ["Excel"] }));
    expect(out.fullName).toBe("کاربر کارجو");
    expect(out.headline).toBeNull();
    expect(out.city).toBeNull();
    expect(out.yearsExperience).toBeNull();
    expect(out.skills).toEqual(["Excel"]);
  });

  it("نامِ AI بر نامِ قبلی اولویت دارد", () => {
    const out = mergeProfileFields(
      existingProfile(),
      parsed({ fullName: "نام تازه" }),
    );
    expect(out.fullName).toBe("نام تازه");
  });
});
