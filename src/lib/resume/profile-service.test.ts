/**
 * تست‌های نرمال‌سازهای خالصِ profile-service (Track C) — بدونِ DB.
 *
 * تمرکز: پاک‌سازیِ ورودیِ کاربر پیش از ذخیره — trim، حذفِ ردیف/فیلدِ خالی، dedupe،
 * سقفِ تعداد، و رفتارِ «تا کنون» (current) که endDate را می‌بندد.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeEducation,
  normalizeLanguages,
  normalizeLinks,
  normalizeSkills,
  normalizeWorkExperience,
} from "@/lib/resume/profile-service";

describe("normalizeSkills", () => {
  it("trim، حذفِ خالی، dedupe بدونِ حساسیت به بزرگی/کوچکی", () => {
    expect(normalizeSkills(["  React ", "react", "", "  ", "TypeScript"])).toEqual([
      "React",
      "TypeScript",
    ]);
  });

  it("سقفِ ۵۰", () => {
    const many = Array.from({ length: 60 }, (_, i) => `skill-${i}`);
    expect(normalizeSkills(many)).toHaveLength(50);
  });
});

describe("normalizeWorkExperience", () => {
  it("ردیفِ کاملاً خالی حذف می‌شود", () => {
    expect(
      normalizeWorkExperience([{}, { company: "  " }, { title: "توسعه‌دهنده" }]),
    ).toEqual([{ title: "توسعه‌دهنده" }]);
  });

  it("current=true → endDate بسته می‌شود، current نگه‌داشته", () => {
    expect(
      normalizeWorkExperience([
        { company: "الف", current: true, endDate: "۱۴۰۱" },
      ]),
    ).toEqual([{ company: "الف", current: true }]);
  });

  it("فیلدهای خالی trim/حذف می‌شوند", () => {
    expect(
      normalizeWorkExperience([
        { company: " شرکت ", title: "", startDate: "۱۳۹۸", description: "  " },
      ]),
    ).toEqual([{ company: "شرکت", startDate: "۱۳۹۸" }]);
  });
});

describe("normalizeEducation", () => {
  it("ردیفِ خالی حذف، فیلدهای معنادار trim", () => {
    expect(
      normalizeEducation([
        {},
        { institution: " دانشگاه ", degree: "کارشناسی", field: "" },
      ]),
    ).toEqual([{ institution: "دانشگاه", degree: "کارشناسی" }]);
  });
});

describe("normalizeLanguages", () => {
  it("ردیفِ بی‌نام حذف، dedupe بر نام، level اختیاری", () => {
    expect(
      normalizeLanguages([
        { name: "", level: "مسلط" },
        { name: " انگلیسی ", level: " C1 " },
        { name: "انگلیسی", level: "متوسط" },
        { name: "فارسی" },
      ]),
    ).toEqual([
      { name: "انگلیسی", level: "C1" },
      { name: "فارسی" },
    ]);
  });
});

describe("normalizeLinks", () => {
  it("ردیفِ بی‌url حذف، dedupe بر url نرمال‌شده (بی‌اسلشِ پایانی)", () => {
    expect(
      normalizeLinks([
        { url: "" },
        { url: "https://Example.com/", label: " سایت " },
        { url: "https://example.com" },
        { url: "https://github.com/x", label: "گیت‌هاب" },
      ]),
    ).toEqual([
      { url: "https://Example.com/", label: "سایت" },
      { url: "https://github.com/x", label: "گیت‌هاب" },
    ]);
  });

  it("سقفِ ۱۵", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://x${i}.com` }));
    expect(normalizeLinks(many)).toHaveLength(15);
  });
});
