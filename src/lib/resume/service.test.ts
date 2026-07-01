/**
 * تست‌های منطقِ خالصِ سرویسِ رزومه (merge) — بدونِ DB.
 *
 * تمرکز: merge محتاطانه‌ی فیلدهای parsed روی پروفایلِ موجود (WF2 — «پر کردنِ خالی‌ها»)،
 * تا داده/ویرایشِ قبلیِ کاربر پاک نشود، اسکالرها فقط وقتی خالی‌اند پر شوند، و آرایه‌ها
 * (مهارت/سابقه/تحصیلات/زبان/لینک) افزوده و dedupe شوند.
 */
import { describe, expect, it } from "vitest";

import {
  mergeEducation,
  mergeLanguages,
  mergeLinks,
  mergeProfileFields,
  mergeSkills,
  mergeWorkExperience,
} from "@/lib/resume/service";
import type { ParsedResume } from "@/lib/resume/schema";

/**
 * ساختِ یک ParsedResume کمینه با مقادیرِ دلخواه. ورودی عمداً loose است (Record) تا
 * ردیف‌های آرایه‌ای را بدونِ تکرارِ همه‌ی کلیدهای اختیاری بتوان نوشت (زد schema همه را
 * اختیاری می‌گیرد؛ این helper همان شکل را برای تست بازمی‌سازد).
 */
function parsed(partial: Record<string, unknown> = {}): ParsedResume {
  return {
    skills: [],
    experience: [],
    education: [],
    languages: [],
    links: [],
    ...partial,
  } as unknown as ParsedResume;
}

/** ساختِ یک ردیفِ پروفایلِ موجودِ کمینه. */
function existingProfile(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    userId: "u1",
    fullName: "نام قبلی",
    headline: "عنوان قبلی",
    summary: null,
    skills: ["Git"],
    yearsExperience: 2,
    city: "اصفهان",
    phone: null,
    expectedSalary: null,
    avatarUrl: null,
    workExperience: [],
    education: [],
    languages: [],
    links: [],
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

describe("mergeProfileFields — اسکالرها (fill-empties)", () => {
  it("مقدارِ موجودِ کاربر را حفظ می‌کند حتی اگر AI مقدارِ تازه بدهد (کلوبر نمی‌کند)", () => {
    const out = mergeProfileFields(
      existingProfile(),
      parsed({ headline: "عنوان جدید", city: "تهران", skills: ["React"] }),
    );
    // fill-empties: headline/city قبلاً پر بودند → مقدارِ قبلی حفظ می‌شود.
    expect(out.headline).toBe("عنوان قبلی");
    expect(out.city).toBe("اصفهان");
    expect(out.yearsExperience).toBe(2);
    // مهارت‌ها append+dedupe.
    expect(out.skills).toEqual(["Git", "React"]);
    // نامِ AI نبود → نامِ قبلی حفظ می‌شود.
    expect(out.fullName).toBe("نام قبلی");
  });

  it("فیلدِ خالیِ کاربر را با مقدارِ AI پر می‌کند", () => {
    const out = mergeProfileFields(
      existingProfile({ headline: null, city: null, phone: null }),
      parsed({
        headline: "مهندس نرم‌افزار",
        city: "شیراز",
        phone: "0912",
        summary: "درباره‌ی من",
        expectedSalary: "توافقی",
      }),
    );
    expect(out.headline).toBe("مهندس نرم‌افزار");
    expect(out.city).toBe("شیراز");
    expect(out.phone).toBe("0912");
    expect(out.summary).toBe("درباره‌ی من");
    expect(out.expectedSalary).toBe("توافقی");
  });

  it("بدونِ پروفایلِ قبلی و بدونِ نامِ AI، نامِ پیش‌فرضِ امن می‌گذارد", () => {
    const out = mergeProfileFields(null, parsed({ skills: ["Excel"] }));
    expect(out.fullName).toBe("کاربر کارجو");
    expect(out.headline).toBeNull();
    expect(out.city).toBeNull();
    expect(out.summary).toBeNull();
    expect(out.phone).toBeNull();
    expect(out.expectedSalary).toBeNull();
    expect(out.yearsExperience).toBeNull();
    expect(out.skills).toEqual(["Excel"]);
    expect(out.workExperience).toEqual([]);
    expect(out.education).toEqual([]);
    expect(out.languages).toEqual([]);
    expect(out.links).toEqual([]);
  });

  it("نامِ AI فقط وقتی پر می‌شود که پروفایلِ قبلی نام نداشته باشد", () => {
    const out = mergeProfileFields(null, parsed({ fullName: "نام تازه" }));
    expect(out.fullName).toBe("نام تازه");
  });

  it("نامِ قبلیِ واقعیِ کاربر بر نامِ AI اولویت دارد (کلوبر نمی‌کند)", () => {
    const out = mergeProfileFields(
      existingProfile(),
      parsed({ fullName: "نام تازه" }),
    );
    expect(out.fullName).toBe("نام قبلی");
  });

  it("اگر نامِ قبلی صرفاً placeholderِ پیش‌فرض بود، نامِ AI جایگزینش می‌شود", () => {
    const out = mergeProfileFields(
      existingProfile({ fullName: "کاربر کارجو" }),
      parsed({ fullName: "نام واقعی" }),
    );
    expect(out.fullName).toBe("نام واقعی");
  });
});

describe("mergeProfileFields — آرایه‌ها (append + dedupe)", () => {
  it("سابقه‌ی کاریِ AI را به سابقه‌ی موجود می‌افزاید و تکراری را حذف می‌کند", () => {
    const out = mergeProfileFields(
      existingProfile({
        workExperience: [{ company: "شرکت الف", title: "برنامه‌نویس", startDate: "1398" }],
      }),
      parsed({
        experience: [
          { company: "شرکت الف", title: "برنامه‌نویس", startDate: "1398" }, // تکراری
          { company: "شرکت ب", title: "مدیر فنی", startDate: "1401", current: true },
        ],
      }),
    );
    expect(out.workExperience).toHaveLength(2);
    expect(out.workExperience[1].company).toBe("شرکت ب");
    expect(out.workExperience[1].current).toBe(true);
  });

  it("تحصیلات/زبان/لینک را افزوده و dedupe می‌کند", () => {
    const out = mergeProfileFields(
      existingProfile({
        education: [{ institution: "دانشگاه تهران", degree: "کارشناسی", field: "کامپیوتر" }],
        languages: [{ name: "فارسی", level: "مادری" }],
        links: [{ url: "https://example.com", label: "سایت" }],
      }),
      parsed({
        education: [{ institution: "دانشگاه تهران", degree: "کارشناسی", field: "کامپیوتر" }],
        languages: [
          { name: "فارسی", level: "مادری" },
          { name: "English", level: "C1" },
        ],
        links: [{ url: "https://example.com/" }, { url: "https://github.com/u" }],
      }),
    );
    expect(out.education).toHaveLength(1);
    expect(out.languages.map((l) => l.name)).toEqual(["فارسی", "English"]);
    expect(out.links).toHaveLength(2); // example.com (dedupe با trailing slash) + github
  });
});

describe("merge helpers — مرزها", () => {
  it("mergeWorkExperience ردیفِ کاملاً خالی را حذف می‌کند", () => {
    expect(mergeWorkExperience([], [{}, { title: "الف" }])).toEqual([{ title: "الف" }]);
  });

  it("mergeEducation null-safe است (داده‌ی legacy)", () => {
    expect(mergeEducation(null, undefined)).toEqual([]);
  });

  it("mergeLanguages ردیفِ بدونِ نام را حذف و level خالی را نگه نمی‌دارد", () => {
    expect(mergeLanguages([], [{ name: "  " }, { name: "عربی", level: " " }])).toEqual([
      { name: "عربی" },
    ]);
  });

  it("mergeLinks url خالی را حذف و trailing slash را برای dedupe نرمال می‌کند", () => {
    expect(
      mergeLinks([{ url: "https://a.com/" }], [{ url: "https://a.com" }, { url: "" }]),
    ).toEqual([{ url: "https://a.com/" }]);
  });
});
