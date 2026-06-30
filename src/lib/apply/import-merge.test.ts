/**
 * تستِ منطقِ merge وصله‌ی ایمپورت روی پروفایلِ کاربر (خالص، بدونِ DB).
 *
 * قاعده‌های بحرانیِ Track C که تأیید می‌شوند:
 *   • skills همیشه union/append می‌شود (هرگز clobber/کاهش).
 *   • فیلدهای تک‌مقداری فقط *خالی‌ها* را پر می‌کنند (مقدارِ ویرایش‌شده‌ی کاربر دست‌نخورده).
 *   • appliedFieldNames دقیقاً همان فیلدهایی است که واقعاً تغییر کردند.
 */
import { describe, expect, it } from "vitest";

import { mergeProfilePatch } from "@/lib/apply/import-merge";

describe("mergeProfilePatch — پر کردنِ خالی‌ها (بدونِ clobber)", () => {
  it("پروفایلِ نداشته (undefined) → همه‌ی فیلدهای patch اعمال می‌شوند", () => {
    const r = mergeProfilePatch(undefined, {
      fullName: "علی",
      headline: "بک‌اند",
      skills: ["Go"],
      yearsExperience: 4,
      city: "تهران",
      resumeText: "خلاصه",
    });
    expect(r.changed).toEqual({
      fullName: "علی",
      headline: "بک‌اند",
      skills: ["Go"],
      yearsExperience: 4,
      city: "تهران",
      resumeText: "خلاصه",
    });
    expect(r.appliedFieldNames.sort()).toEqual(
      ["city", "fullName", "headline", "resumeText", "skills", "yearsExperience"].sort(),
    );
  });

  it("فیلدِ معنادارِ موجودِ کاربر را بازنویسی نمی‌کند", () => {
    const r = mergeProfilePatch(
      { fullName: "نامِ کاربر", headline: "عنوانِ کاربر", city: "شیراز" },
      { fullName: "نامِ ایمپورت", headline: "عنوانِ ایمپورت", city: "تهران" },
    );
    expect(r.changed.fullName).toBeUndefined();
    expect(r.changed.headline).toBeUndefined();
    expect(r.changed.city).toBeUndefined();
    expect(r.appliedFieldNames).toEqual([]);
  });

  it("فیلدِ خالی/رشته‌ی فضای‌خالیِ کاربر را پر می‌کند", () => {
    const r = mergeProfilePatch(
      { fullName: "  ", headline: null, city: "" },
      { fullName: "علی", headline: "بک‌اند", city: "تهران" },
    );
    expect(r.changed.fullName).toBe("علی");
    expect(r.changed.headline).toBe("بک‌اند");
    expect(r.changed.city).toBe("تهران");
    expect(r.appliedFieldNames.sort()).toEqual(["city", "fullName", "headline"]);
  });

  it("yearsExperience=0 موجود را معتبر می‌شمارد (بازنویسی نمی‌کند)", () => {
    const r = mergeProfilePatch({ yearsExperience: 0 }, { yearsExperience: 5 });
    expect(r.changed.yearsExperience).toBeUndefined();
    expect(r.appliedFieldNames).toEqual([]);
  });

  it("yearsExperience نداشته (null) را پر می‌کند", () => {
    const r = mergeProfilePatch({ yearsExperience: null }, { yearsExperience: 5 });
    expect(r.changed.yearsExperience).toBe(5);
    expect(r.appliedFieldNames).toEqual(["yearsExperience"]);
  });
});

describe("mergeProfilePatch — union مهارت‌ها", () => {
  it("مهارت‌های تازه را append می‌کند و موجودها را نگه می‌دارد", () => {
    const r = mergeProfilePatch({ skills: ["JS", "TS"] }, { skills: ["TS", "Go"] });
    expect(r.changed.skills).toEqual(["JS", "TS", "Go"]);
    expect(r.addedSkills).toEqual(["Go"]);
    expect(r.appliedFieldNames).toEqual(["skills"]);
  });

  it("تکراریِ case-insensitive را اضافه نمی‌کند → بدونِ تغییر", () => {
    const r = mergeProfilePatch({ skills: ["React"] }, { skills: ["react", "REACT"] });
    expect(r.changed.skills).toBeUndefined();
    expect(r.addedSkills).toEqual([]);
    expect(r.appliedFieldNames).toEqual([]);
  });

  it("کاربر بدونِ مهارت → مهارت‌های ایمپورت اعمال می‌شوند", () => {
    const r = mergeProfilePatch({ skills: [] }, { skills: ["Python"] });
    expect(r.changed.skills).toEqual(["Python"]);
    expect(r.addedSkills).toEqual(["Python"]);
  });

  it("patch بدونِ مهارت → فیلدِ skills تغییر نمی‌کند (فقط fullNameِ خالی پر می‌شود)", () => {
    // existing مهارت دارد ولی نام ندارد → skills بدونِ تغییر، fullName پر می‌شود.
    const r = mergeProfilePatch({ skills: ["JS"] }, { fullName: "x" });
    expect(r.changed.skills).toBeUndefined();
    expect(r.changed.fullName).toBe("x");
    expect(r.appliedFieldNames).toEqual(["fullName"]);
  });

  it("مهارتِ خالی/فضای‌خالی در patch نادیده گرفته می‌شود", () => {
    const r = mergeProfilePatch({ skills: ["JS"] }, { skills: ["  ", "Rust"] });
    expect(r.changed.skills).toEqual(["JS", "Rust"]);
    expect(r.addedSkills).toEqual(["Rust"]);
  });
});

describe("mergeProfilePatch — patchِ خالی", () => {
  it("patchِ بدونِ هیچ فیلدی → هیچ تغییری", () => {
    const r = mergeProfilePatch({ fullName: "علی", skills: ["JS"] }, {});
    expect(r.changed).toEqual({});
    expect(r.appliedFieldNames).toEqual([]);
    expect(r.addedSkills).toEqual([]);
  });
});
