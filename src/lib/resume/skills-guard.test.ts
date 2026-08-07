/**
 * گاردِ ضدِجعلِ مهارت‌ها — رزومه‌ای که به کارفرما می‌رود نباید مهارتی داشته باشد که کاربر ندارد.
 *
 * این رفتار زنده لازم شد: با وجودِ قاعده‌ی صریحِ پرامپت، مدل برای یک آگهیِ Flutter مهارتِ
 * «Flutter» را به کاربری داد که اصلاً Flutter نداشت. پس فیلتر باید قطعی و کدمحور باشد.
 */
import { describe, expect, it } from "vitest";

import { __testables } from "@/lib/resume/custom-resume-service";

const { keepOnlyRealSkills } = __testables;

const PROFILE = ["React", "Next.js", "TypeScript", "Node.js", "Python", "PostgreSQL"];

describe("keepOnlyRealSkills", () => {
  it("مهارتِ جعلی را حذف می‌کند (موردِ واقعی: Flutter)", () => {
    const out = keepOnlyRealSkills(["Flutter", "React", "Node.js"], PROFILE);
    expect(out).not.toContain("Flutter");
    expect(out).toEqual(["React", "Node.js"]);
  });

  it("ترتیبِ هدف‌گیری‌شده‌ی AI را حفظ می‌کند (مرتبط‌ترین اول)", () => {
    const out = keepOnlyRealSkills(["Node.js", "React", "TypeScript"], PROFILE);
    expect(out).toEqual(["Node.js", "React", "TypeScript"]);
  });

  it("نگارشِ متفاوتِ همان مهارت را می‌پذیرد (Next JS ≡ Next.js ≡ nextjs)", () => {
    expect(keepOnlyRealSkills(["Next JS"], PROFILE)).toEqual(["Next JS"]);
    expect(keepOnlyRealSkills(["nextjs"], PROFILE)).toEqual(["nextjs"]);
    expect(keepOnlyRealSkills(["POSTGRESQL"], PROFILE)).toEqual(["POSTGRESQL"]);
  });

  it("تکراری‌ها را حذف می‌کند", () => {
    expect(keepOnlyRealSkills(["React", "react", "React"], PROFILE)).toEqual(["React"]);
  });

  it("اگر همه‌ی خروجیِ AI جعلی بود، به مهارت‌های خودِ پروفایل برمی‌گردد (نه رزومه‌ی بی‌مهارت)", () => {
    expect(keepOnlyRealSkills(["Flutter", "Kotlin", "Swift"], PROFILE)).toEqual(PROFILE);
  });

  it("پروفایلِ بی‌مهارت → خروجیِ خالی (چیزی از هوا ساخته نمی‌شود)", () => {
    expect(keepOnlyRealSkills(["Flutter"], [])).toEqual([]);
  });
});
