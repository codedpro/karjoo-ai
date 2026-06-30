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
});
