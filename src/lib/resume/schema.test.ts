/**
 * تست‌های اسکیمای ساخت‌یافته‌سازیِ رزومه (zod) — مرزها و نرمال‌سازی.
 */
import { describe, expect, it } from "vitest";

import { parsedResumeSchema } from "@/lib/resume/schema";

describe("parsedResumeSchema", () => {
  it("شیء خالی را با آرایه‌های پیش‌فرض می‌پذیرد", () => {
    const r = parsedResumeSchema.parse({});
    expect(r.skills).toEqual([]);
    expect(r.experience).toEqual([]);
    expect(r.education).toEqual([]);
    expect(r.fullName).toBeUndefined();
  });

  it("مهارت‌ها را trim و یکتا می‌کند", () => {
    const r = parsedResumeSchema.parse({
      skills: [" React ", "react ", "TypeScript", "TypeScript"],
    });
    // trim شده ولی case حفظ می‌شود؛ تکراریِ دقیق حذف می‌شود.
    expect(r.skills).toContain("React");
    expect(r.skills).toContain("TypeScript");
    // "react " بعد از trim می‌شود "react" که با "React" متفاوت است → هر دو می‌مانند.
    expect(r.skills.filter((s) => s.toLowerCase() === "typescript")).toHaveLength(1);
  });

  it("سال‌های سابقه‌ی خارج‌ازبازه را رد می‌کند", () => {
    expect(parsedResumeSchema.safeParse({ yearsExperience: -1 }).success).toBe(false);
    expect(parsedResumeSchema.safeParse({ yearsExperience: 99 }).success).toBe(false);
    expect(parsedResumeSchema.safeParse({ yearsExperience: 3.5 }).success).toBe(false);
  });

  it("رشته‌ی خالی برای فیلدهای اختیاری → undefined", () => {
    const r = parsedResumeSchema.parse({ headline: "", city: "  " });
    expect(r.headline).toBeUndefined();
    expect(r.city).toBeUndefined();
  });

  it("ردیف‌های سابقه/تحصیلات را با فیلدهای اختیاری می‌پذیرد", () => {
    const r = parsedResumeSchema.parse({
      experience: [{ title: "مدیر", company: "" }],
      education: [{ degree: "ارشد", field: "MBA" }],
    });
    expect(r.experience[0].title).toBe("مدیر");
    expect(r.experience[0].company).toBeUndefined();
    expect(r.education[0].field).toBe("MBA");
  });

  it("ردیف‌های کاملاً خالیِ سابقه/تحصیلات را فیلتر می‌کند", () => {
    const r = parsedResumeSchema.parse({
      experience: [{}, { title: "توسعه‌دهنده" }],
      education: [{ field: "  " }, { institution: "دانشگاه" }],
    });
    expect(r.experience).toHaveLength(1);
    expect(r.education).toHaveLength(1);
  });

  it("فیلدهای جامعِ WF2 را استخراج/نرمال می‌کند (خلاصه، تلفن، حقوق، تاریخ‌ها، زبان، لینک)", () => {
    const r = parsedResumeSchema.parse({
      summary: "درباره‌ی من",
      phone: "0912",
      expectedSalary: "توافقی",
      experience: [
        {
          company: "شرکت الف",
          title: "برنامه‌نویس",
          startDate: "1398",
          current: "true",
          description: "کار",
        },
      ],
      education: [
        { institution: "دانشگاه تهران", degree: "کارشناسی", startYear: "1394", endYear: "1398" },
      ],
      languages: [{ name: "English", level: "C1" }, { name: "  " }],
      links: [{ label: "لینکدین", url: "https://linkedin.com/in/x" }, { url: "" }],
    });
    expect(r.summary).toBe("درباره‌ی من");
    expect(r.phone).toBe("0912");
    expect(r.expectedSalary).toBe("توافقی");
    expect(r.experience[0].startDate).toBe("1398");
    expect(r.experience[0].current).toBe(true); // "true" → boolean
    expect(r.education[0].startYear).toBe("1394");
    // زبانِ بدونِ نام رد می‌شود (name اجباری) — کلِ parse نباید بشکند.
    expect(r.languages.map((l) => l.name)).toEqual(["English"]);
    // لینکِ بدونِ url رد می‌شود.
    expect(r.links).toHaveLength(1);
    expect(r.links[0].label).toBe("لینکدین");
  });
});
