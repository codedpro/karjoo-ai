/**
 * تست‌های اسکیمای ذخیره‌ی پروفایلِ جامع (WF2) + شکل‌های کمکی — خالص، بدونِ I/O.
 */
import { describe, expect, it } from "vitest";

import {
  resumeProfileSaveSchema,
  resumeSetPrimarySchema,
} from "@/lib/resume/api-schemas";

describe("resumeProfileSaveSchema", () => {
  it("پروفایلِ کامل را می‌پذیرد و آرایه‌ها را نگه می‌دارد", () => {
    const parsed = resumeProfileSaveSchema.parse({
      fullName: " سارا احمدی ",
      headline: "فرانت‌اند",
      summary: "خلاصه",
      city: "تهران",
      phone: "0912",
      expectedSalary: "توافقی",
      yearsExperience: 5,
      skills: ["React"],
      workExperience: [{ company: "الف", current: true }],
      education: [{ institution: "دانشگاه" }],
      languages: [{ name: "انگلیسی", level: "مسلط" }],
      links: [{ url: "https://example.com" }],
    });
    expect(parsed.fullName).toBe("سارا احمدی"); // trim
    expect(parsed.workExperience[0].current).toBe(true);
    expect(parsed.languages[0]).toEqual({ name: "انگلیسی", level: "مسلط" });
  });

  it("فقط fullName اجباری است؛ بقیه با پیش‌فرضِ آرایه‌ی خالی", () => {
    const parsed = resumeProfileSaveSchema.parse({ fullName: "سارا" });
    expect(parsed.skills).toEqual([]);
    expect(parsed.workExperience).toEqual([]);
    expect(parsed.education).toEqual([]);
    expect(parsed.languages).toEqual([]);
    expect(parsed.links).toEqual([]);
  });

  it("نامِ خالی رد می‌شود", () => {
    expect(resumeProfileSaveSchema.safeParse({ fullName: "   " }).success).toBe(false);
  });

  it("زبانِ بی‌نام رد می‌شود (name اجباری)", () => {
    expect(
      resumeProfileSaveSchema.safeParse({
        fullName: "سارا",
        languages: [{ name: "" }],
      }).success,
    ).toBe(false);
  });

  it("لینکِ بی‌url رد می‌شود (url اجباری)", () => {
    expect(
      resumeProfileSaveSchema.safeParse({
        fullName: "سارا",
        links: [{ label: "سایت" }],
      }).success,
    ).toBe(false);
  });

  it("yearsExperience خارج از بازه رد می‌شود", () => {
    expect(
      resumeProfileSaveSchema.safeParse({ fullName: "سارا", yearsExperience: 99 })
        .success,
    ).toBe(false);
  });
});

describe("resumeSetPrimarySchema", () => {
  it("UUID معتبر لازم است", () => {
    expect(
      resumeSetPrimarySchema.safeParse({
        resumeFileId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      }).success,
    ).toBe(true);
    expect(resumeSetPrimarySchema.safeParse({ resumeFileId: "nope" }).success).toBe(
      false,
    );
  });
});
