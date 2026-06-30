/**
 * تستِ قراردادِ ایمپورتِ پروفایل (WF1) — خالص، بدونِ شبکه/DB.
 *
 * تمرکزِ اصلی: نگهبانِ §10 (ردِ هر فیلدِ شبیهِ اعتبارنامه) و نرمال‌سازیِ صحیحِ
 * فیلدهای پروفایل/سوابقِ اپلای از payloadِ خام.
 */
import { describe, expect, it } from "vitest";

import {
  CredentialLeakError,
  assertNoCredentials,
  genericNormalize,
  hasImporter,
  normalizeImportedProfile,
} from "@/lib/apply/import";

describe("نگهبانِ §10: ردِ اعتبارنامه", () => {
  it("payloadِ تمیز را می‌پذیرد (throw نمی‌کند)", () => {
    expect(() =>
      assertNoCredentials({ fullName: "علی", skills: ["JS", "TS"], city: "تهران" }),
    ).not.toThrow();
  });

  it.each([
    ["cookie", { cookie: "a=b" }],
    ["sessionToken", { sessionToken: "x" }],
    ["password", { profile: { password: "1234" } }],
    ["accessToken (تودرتو)", { data: { auth: { accessToken: "jwt..." } } }],
    ["authorization header", { headers: { Authorization: "Bearer x" } }],
    ["در آرایه", { items: [{ ok: 1 }, { csrfToken: "y" }] }],
    ["apiKey", { apiKey: "secret" }],
    ["jwt", { jwt: "ey..." }],
    ["localStorage session", { sessionBlob: "..." }],
  ])("فیلدِ شبیهِ اعتبارنامه را رد می‌کند: %s", (_label, payload) => {
    expect(() => assertNoCredentials(payload)).toThrow(CredentialLeakError);
  });

  it("normalizeImportedProfile قبل از نرمال‌سازی، اعتبارنامه را رد می‌کند", () => {
    expect(() =>
      normalizeImportedProfile("jobinja", { fullName: "x", refreshToken: "y" }),
    ).toThrow(CredentialLeakError);
  });

  it("CredentialLeakError نامِ فیلدِ مشکوک را گزارش می‌کند", () => {
    try {
      assertNoCredentials({ a: { b: { cookie: "x" } } });
      expect.unreachable("باید throw می‌کرد");
    } catch (e) {
      expect(e).toBeInstanceOf(CredentialLeakError);
      expect((e as CredentialLeakError).field).toBe("a.b.cookie");
    }
  });

  it("ساختارِ بیش از حد عمیق را رد می‌کند (دفاع در برابرِ payloadِ مخرب)", () => {
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i += 1) deep = { nest: deep };
    expect(() => assertNoCredentials(deep)).toThrow(CredentialLeakError);
  });
});

describe("genericNormalize", () => {
  it("فیلدهای پروفایلِ تخت را نرمال می‌کند", () => {
    const out = genericNormalize({
      fullName: "  مریم رضایی ",
      headline: "توسعه‌دهنده‌ی فرانت‌اند",
      skills: ["React", " TypeScript ", "react"], // تکراریِ case-insensitive
      yearsExperience: "۵ سال نیست → عددِ انگلیسی",
      city: "اصفهان",
      summary: "خلاصه‌ی رزومه",
    });
    expect(out.profilePatch.fullName).toBe("مریم رضایی");
    expect(out.profilePatch.headline).toBe("توسعه‌دهنده‌ی فرانت‌اند");
    expect(out.profilePatch.skills).toEqual(["React", "TypeScript"]);
    expect(out.profilePatch.city).toBe("اصفهان");
    expect(out.profilePatch.resumeText).toBe("خلاصه‌ی رزومه");
  });

  it("yearsExperience عددی را از رشته/عدد می‌خواند", () => {
    expect(genericNormalize({ yearsExperience: 7 }).profilePatch.yearsExperience).toBe(7);
    expect(
      genericNormalize({ yearsExperience: "8 years" }).profilePatch.yearsExperience,
    ).toBe(8);
  });

  it("مهارت‌های رشته‌ایِ جداشده با ویرگول را می‌شکند", () => {
    const out = genericNormalize({ skills: "Java، Spring, SQL" });
    expect(out.profilePatch.skills).toEqual(["Java", "Spring", "SQL"]);
  });

  it("فیلدهای غایب را undefined می‌گذارد (patch خالی از کلیدِ undefined)", () => {
    const out = genericNormalize({ city: "تهران" });
    expect(out.profilePatch).toEqual({ city: "تهران" });
    expect("fullName" in out.profilePatch).toBe(false);
  });

  it("شیءِ profile تودرتو را می‌فهمد", () => {
    const out = genericNormalize({ profile: { name: "حسن", city: "شیراز" } });
    expect(out.profilePatch.fullName).toBe("حسن");
    expect(out.profilePatch.city).toBe("شیراز");
  });

  it("سوابقِ اپلای را نرمال می‌کند", () => {
    const out = genericNormalize({
      fullName: "x",
      applications: [
        { title: "بک‌اند", company: "اسنپ", status: "در حال بررسی", jobId: "A1" },
        { irrelevant: true }, // بدونِ فیلدِ معنادار → حذف
      ],
    });
    expect(out.applications).toHaveLength(1);
    expect(out.applications?.[0]).toMatchObject({
      title: "بک‌اند",
      company: "اسنپ",
      status: "در حال بررسی",
      externalRef: "A1",
    });
  });

  it("وقتی سابقه‌ای نیست، applications را undefined می‌گذارد", () => {
    expect(genericNormalize({ fullName: "x" }).applications).toBeUndefined();
  });
});

describe("رجیستریِ نرمال‌ساز", () => {
  it("هر چهار سایتِ هدفِ WF1 نرمال‌سازِ ثبت‌شده دارند", () => {
    expect(hasImporter("jobinja")).toBe(true);
    expect(hasImporter("jobvision")).toBe(true);
    expect(hasImporter("e-estekhdam")).toBe(true);
    expect(hasImporter("irantalent")).toBe(true);
  });

  it("normalizeImportedProfile برای هر سایت کار می‌کند (fallback به generic)", () => {
    for (const board of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
      const out = normalizeImportedProfile(board, { fullName: "تست" });
      expect(out.profilePatch.fullName).toBe("تست");
    }
  });
});

describe("نرمال‌سازِ هر سایت — نگاشتِ فیلدهای واقعی", () => {
  it("جابینجا: کلیدهای اختصاصی (about_me/field/skill_tags/my_applications)", () => {
    const out = normalizeImportedProfile("jobinja", {
      first_and_last_name: "سارا کریمی",
      field: "توسعه‌ی نرم‌افزار",
      skill_tags: ["Node.js", "PostgreSQL"],
      resident_city: "تهران",
      about_me: "مهندس بک‌اند با ۶ سال سابقه.",
      my_applications: [
        { title: "بک‌اند سینیور", company: "دیجی‌کالا", status: "بررسی", jobId: "J-9" },
      ],
    });
    expect(out.profilePatch.fullName).toBe("سارا کریمی");
    expect(out.profilePatch.headline).toBe("توسعه‌ی نرم‌افزار");
    expect(out.profilePatch.skills).toEqual(["Node.js", "PostgreSQL"]);
    expect(out.profilePatch.city).toBe("تهران");
    expect(out.profilePatch.resumeText).toBe("مهندس بک‌اند با ۶ سال سابقه.");
    expect(out.applications).toHaveLength(1);
    expect(out.applications?.[0]).toMatchObject({
      title: "بک‌اند سینیور",
      company: "دیجی‌کالا",
      externalRef: "J-9",
    });
  });

  it("جاب‌ویژن: شیءِ resume تودرتو، firstName+lastName، skills:[{title}], requests", () => {
    const out = normalizeImportedProfile("jobvision", {
      resume: {
        firstName: "علی",
        lastName: "محمدی",
        jobTitle: "مهندس داده",
        skills: [{ title: "Python" }, { title: "Spark" }],
        totalWorkExperience: 9,
        cityTitle: "مشهد",
        aboutMe: "تحلیل‌گرِ داده.",
      },
      requests: [{ jobTitle: "مهندس داده", company: "همراه‌اول", state: "ارسال‌شده" }],
    });
    expect(out.profilePatch.fullName).toBe("علی محمدی");
    expect(out.profilePatch.headline).toBe("مهندس داده");
    expect(out.profilePatch.skills).toEqual(["Python", "Spark"]);
    expect(out.profilePatch.yearsExperience).toBe(9);
    expect(out.profilePatch.city).toBe("مشهد");
    expect(out.profilePatch.resumeText).toBe("تحلیل‌گرِ داده.");
    expect(out.applications).toHaveLength(1);
    expect(out.applications?.[0]).toMatchObject({ title: "مهندس داده", company: "همراه‌اول" });
  });

  it("ای‌استخدام: کلیدهای فارسی/تماس‌محور (job_category/specialties/resume)", () => {
    const out = normalizeImportedProfile("e-estekhdam", {
      profile: {
        name: "نگار احمدی",
        job_category: "حسابداری",
        specialties: "Excel، نرم‌افزارِ هلو, مالیات",
        resident_city: "کرج",
        resume: "حسابدارِ ارشد.",
      },
    });
    expect(out.profilePatch.fullName).toBe("نگار احمدی");
    expect(out.profilePatch.headline).toBe("حسابداری");
    expect(out.profilePatch.skills).toEqual(["Excel", "نرم‌افزارِ هلو", "مالیات"]);
    expect(out.profilePatch.city).toBe("کرج");
    expect(out.profilePatch.resumeText).toBe("حسابدارِ ارشد.");
  });

  it("ایران‌تلنت: انگلیسی‌محور (firstName+lastName/currentPosition/skills:[{name}])", () => {
    const out = normalizeImportedProfile("irantalent", {
      profile: {
        firstName: "Reza",
        lastName: "Hosseini",
        currentPosition: "Product Manager",
        skills: [{ name: "Roadmapping" }, { name: "Analytics" }],
        experienceYears: 11,
        cityName: "Tehran",
        summary: "PM with SaaS background.",
      },
    });
    expect(out.profilePatch.fullName).toBe("Reza Hosseini");
    expect(out.profilePatch.headline).toBe("Product Manager");
    expect(out.profilePatch.skills).toEqual(["Roadmapping", "Analytics"]);
    expect(out.profilePatch.yearsExperience).toBe(11);
    expect(out.profilePatch.city).toBe("Tehran");
    expect(out.profilePatch.resumeText).toBe("PM with SaaS background.");
  });

  it("نگاشتِ اختصاصی، فیلدِ پرشده‌ی generic را بازنویسی نمی‌کند (generic اولویت)", () => {
    // generic از کلیدِ `headline` می‌خواند؛ نگاشتِ جابینجا از `field`. هر دو حاضرند.
    const out = normalizeImportedProfile("jobinja", {
      headline: "عنوانِ generic",
      field: "عنوانِ جابینجا",
    });
    expect(out.profilePatch.headline).toBe("عنوانِ generic");
  });

  it("مهارت‌های generic و اختصاصیِ سایت union می‌شوند (یکتا)", () => {
    const out = normalizeImportedProfile("jobinja", {
      skills: ["React"],
      skill_tags: ["react", "Vue"], // react تکراریِ case-insensitive
    });
    expect(out.profilePatch.skills).toEqual(["React", "Vue"]);
  });

  it("نگاشتِ اختصاصی هم اعتبارنامه را رد می‌کند (دفاع در عمق)", () => {
    expect(() =>
      normalizeImportedProfile("jobvision", { resume: { firstName: "x", authToken: "y" } }),
    ).toThrow(CredentialLeakError);
  });
});
