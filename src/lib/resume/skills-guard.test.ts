/**
 * گاردِ ضدِجعلِ مهارت‌ها — رزومه‌ای که به کارفرما می‌رود نباید مهارتی داشته باشد که کاربر ندارد.
 *
 * این رفتار زنده لازم شد: با وجودِ قاعده‌ی صریحِ پرامپت، مدل برای یک آگهیِ Flutter مهارتِ
 * «Flutter» را به کاربری داد که اصلاً Flutter نداشت. پس فیلتر باید قطعی و کدمحور باشد.
 */
import { describe, expect, it } from "vitest";

import { __testables } from "@/lib/resume/custom-resume-service";

const { keepOnlyRealSkills } = __testables;

/** «شاهد» حالا کلِ دادهٔ کاربر است — این نمونه شاملِ متنِ رزومه هم هست. */
const EVIDENCE = [
  "مهارت‌ها: React، Next.js، TypeScript، Node.js، Python، PostgreSQL",
  "متنِ رزومه: Built REST APIs with Node.js and deployed them with Docker on AWS.",
].join("\n");
const PROFILE_ONLY = "React Next.js TypeScript Node.js Python PostgreSQL";

describe("keepOnlyRealSkills", () => {
  it("مهارتِ جعلی را حذف می‌کند (موردِ واقعی: Flutter)", () => {
    const out = keepOnlyRealSkills(["Flutter", "React", "Node.js"], EVIDENCE);
    expect(out).not.toContain("Flutter");
    expect(out).toEqual(["React", "Node.js"]);
  });

  it("ترتیبِ هدف‌گیری‌شده‌ی AI را حفظ می‌کند (مرتبط‌ترین اول)", () => {
    const out = keepOnlyRealSkills(["Node.js", "React", "TypeScript"], EVIDENCE);
    expect(out).toEqual(["Node.js", "React", "TypeScript"]);
  });

  it("نگارشِ متفاوتِ همان مهارت را می‌پذیرد (Next JS ≡ Next.js ≡ nextjs)", () => {
    expect(keepOnlyRealSkills(["Next JS"], EVIDENCE)).toEqual(["Next JS"]);
    expect(keepOnlyRealSkills(["nextjs"], EVIDENCE)).toEqual(["nextjs"]);
    expect(keepOnlyRealSkills(["POSTGRESQL"], EVIDENCE)).toEqual(["POSTGRESQL"]);
  });

  it("تکراری‌ها را حذف می‌کند", () => {
    expect(keepOnlyRealSkills(["React", "react", "React"], EVIDENCE)).toEqual(["React"]);
  });

  it("مهارتی که فقط در متنِ رزومه آمده (نه در آرایه‌ی skills) پذیرفته می‌شود", () => {
    // این همان سهل‌گیری‌ای است که «بگذار AI تصمیم بگیرد چه چیزی مناسب است» می‌خواهد.
    expect(keepOnlyRealSkills(["Docker", "AWS"], EVIDENCE)).toEqual(["Docker", "AWS"]);
    // ولی همان‌ها وقتی هیچ شاهدی ندارند، حذف می‌شوند.
    expect(keepOnlyRealSkills(["Docker", "AWS"], PROFILE_ONLY)).toEqual([]);
  });

  it("همه‌ی خروجی بی‌شاهد → خالی (چیزی از هوا ساخته نمی‌شود)", () => {
    expect(keepOnlyRealSkills(["Flutter", "Kotlin", "Swift"], EVIDENCE)).toEqual([]);
  });
});

describe("مهارتِ اعلامیِ خودِ کاربر", () => {
  // موردِ واقعی: کاربر Flutter بلد است ولی در رزومه‌ی آپلودی‌اش نیامده. کافی است خودش
  // اعلامش کند (preferences.declaredSkills) — آن‌وقت AI آزاد است برای آگهیِ Flutter
  // جلویش بیاورد. مرجعِ توانایی‌های کاربر خودِ اوست؛ چیزی که ما نمی‌سازیم ادعای بی‌اعلام است.
  const WITH_DECLARED = [
    "مهارت‌ها: React، Node.js",
    "متنِ رزومه: Built REST APIs with Node.js.",
    "Flutter، Dart", // ← declaredSkills
  ].join("\n");

  it("مهارتِ اعلام‌شده‌ی کاربر پذیرفته می‌شود (Flutter)", () => {
    expect(keepOnlyRealSkills(["Flutter", "Dart", "React"], WITH_DECLARED)).toEqual([
      "Flutter",
      "Dart",
      "React",
    ]);
  });

  it("بدونِ اعلام، همان مهارت حذف می‌شود", () => {
    expect(keepOnlyRealSkills(["Flutter"], "مهارت‌ها: React، Node.js")).toEqual([]);
  });
});
