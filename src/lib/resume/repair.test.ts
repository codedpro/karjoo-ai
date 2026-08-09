/**
 * سنجشِ شکافِ رزومه — قطعی و در کد، نه با پرسیدن از مدل.
 *
 * درسی که این را لازم کرد: بزرگ‌تر کردنِ پرامپتِ اصلی هر بار چیزِ دیگری را خراب کرد
 * (یک‌بار کلِ خروجی را به فارسی برد). پس سنجش این‌جاست و پیامِ ترمیم حداقلی می‌ماند.
 */
import { describe, expect, it } from "vitest";

import type { ResumeTailorOutput } from "@/lib/ai/schema";
import {
  REPAIR_CHAR_FLOOR,
  buildRepairInstruction,
  findResumeGaps,
  needsRepair,
  tailoredPlainText,
} from "@/lib/resume/repair";
import { isPersianScript, preferLanguage } from "@/lib/resume/script-match";

const base = (over: Partial<ResumeTailorOutput> = {}): ResumeTailorOutput => ({
  headline: "AI Software Developer",
  summary: "Eight years building Python services with FastAPI and PostgreSQL.",
  skills: ["Python", "FastAPI", "PostgreSQL"],
  experience: [
    {
      company: "CodeNest",
      title: "Founder",
      period: "2018 – Present",
      context: "Independent studio delivering full-stack products.",
      bullets: ["Built REST APIs with FastAPI and Redis."],
    },
  ],
  highlights: ["Delivered 200+ projects."],
  ...over,
});

describe("findResumeGaps", () => {
  it("اصطلاحِ نیامده را پیدا می‌کند", () => {
    const g = findResumeGaps(base(), ["Python", "NoSQL", "Scrum"]);
    expect(g.missingTerms).toEqual(["NoSQL", "Scrum"]);
  });

  it("نگارشِ متفاوت را «آمده» می‌شمارد", () => {
    expect(findResumeGaps(base(), ["fast api", "Post-greSQL"]).missingTerms).toEqual([]);
  });

  it("متنِ کوتاه را کوتاه اعلام می‌کند", () => {
    expect(findResumeGaps(base(), []).tooShort).toBe(true);
  });

  it("متنِ به‌اندازه کوتاه اعلام نمی‌شود", () => {
    const long = base({ summary: "x".repeat(REPAIR_CHAR_FLOOR + 200) });
    expect(findResumeGaps(long, []).tooShort).toBe(false);
  });

  it("context و highlights هم در سنجش دیده می‌شوند", () => {
    const t = tailoredPlainText(base());
    expect(t).toContain("Independent studio");
    expect(t).toContain("200+ projects");
  });
});

describe("needsRepair", () => {
  it("بدونِ شکاف و با طولِ کافی، ترمیم لازم نیست", () => {
    const long = base({ summary: "x".repeat(REPAIR_CHAR_FLOOR + 200) });
    expect(needsRepair(findResumeGaps(long, ["Python"]))).toBe(false);
  });

  it("اصطلاحِ گم‌شده ترمیم را لازم می‌کند", () => {
    expect(needsRepair(findResumeGaps(base(), ["Scrum"]))).toBe(true);
  });
});

describe("buildRepairInstruction", () => {
  it("فقط اصطلاح‌های گم‌شده را نام می‌برد", () => {
    const s = buildRepairInstruction(findResumeGaps(base(), ["Scrum", "Python"]), "en");
    expect(s).toContain("Scrum");
    expect(s).not.toContain("، Python");
  });

  it("ساختنِ عددِ تازه را منع می‌کند", () => {
    expect(buildRepairInstruction(findResumeGaps(base(), []), "en")).toContain("عددِ تازه‌ای نساز");
  });

  it("زبانِ خروجی را تثبیت می‌کند", () => {
    expect(buildRepairInstruction(findResumeGaps(base(), []), "en")).toContain("انگلیسی");
    expect(buildRepairInstruction(findResumeGaps(base(), []), "fa")).toContain("فارسی");
  });

  it("شرکت/عنوان/بازه را قفل می‌کند", () => {
    expect(buildRepairInstruction(findResumeGaps(base(), []), "en")).toContain("بازه‌های زمانی");
  });
});

/**
 * انتخابِ داده‌ی هم‌زبان — پروفایلِ واقعی هر دو نسخه‌ی فارسی و انگلیسیِ تحصیلات را داشت و
 * رزومه‌ی انگلیسی هر دو ردیف را کنارِ هم چاپ می‌کرد.
 */
describe("preferLanguage", () => {
  const EDU = [
    { institution: "دانشگاه آزاد بابل", field: "مهندسی کامپیوتر" },
    { institution: "Islamic Azad University", field: "Computer Engineering" },
  ];
  const textOf = (e: { institution: string; field: string }) => `${e.institution} ${e.field}`;

  it("رزومه‌ی انگلیسی فقط ردیفِ انگلیسی را می‌گیرد", () => {
    expect(preferLanguage(EDU, "en", textOf).map((e) => e.institution)).toEqual([
      "Islamic Azad University",
    ]);
  });

  it("رزومه‌ی فارسی فقط ردیفِ فارسی را می‌گیرد", () => {
    expect(preferLanguage(EDU, "fa", textOf).map((e) => e.institution)).toEqual([
      "دانشگاه آزاد بابل",
    ]);
  });

  it("اگر هیچ ردیفی هم‌زبان نبود، همه می‌مانند (بخش خالی نشود)", () => {
    const only = [EDU[0]!];
    expect(preferLanguage(only, "en", textOf)).toHaveLength(1);
  });

  it("فهرستِ خالی → خالی", () => {
    expect(preferLanguage([], "en", textOf)).toEqual([]);
  });

  it("ارقامِ فارسیِ تنها، متن را فارسی نمی‌کند", () => {
    expect(isPersianScript("۱۴۰۲")).toBe(false);
    expect(isPersianScript("دانشگاه")).toBe(true);
  });
});

/**
 * عددِ ساختگی — خطرناک‌ترین چیزی که مدل می‌تواند بنویسد.
 *
 * زنده دیده شد: «۳۰٪ کاهش کارهای دستی» و «۱۵٪ بهبود کارایی کوئری» که هیچ‌کدام در
 * سابقه‌ی کاربر نبودند. درصدِ ساختگی اولین چیزی است که در مصاحبه پرسیده می‌شود.
 */
describe("ungroundedFigures", () => {
  const EVIDENCE = "improved efficiency by 20%, auto-resolves ~90% of messages, 2M+ subscribers";

  const withPct = (pct: string) =>
    base({
      experience: [
        { company: "CodeNest", title: "Founder", bullets: [`Cut manual work by ${pct}.`] },
      ],
    });

  it("درصدی که در سابقه نیست را می‌گیرد", () => {
    expect(findResumeGaps(withPct("30%"), [], EVIDENCE).ungroundedFigures).toEqual(["30%"]);
  });

  it("درصدِ واقعیِ سابقه را نمی‌گیرد", () => {
    expect(findResumeGaps(withPct("20%"), [], EVIDENCE).ungroundedFigures).toEqual([]);
    expect(findResumeGaps(withPct("90%"), [], EVIDENCE).ungroundedFigures).toEqual([]);
  });

  it("فاصله‌ی پیش از ٪ فرقی نمی‌کند", () => {
    expect(findResumeGaps(withPct("20 %"), [], EVIDENCE).ungroundedFigures).toEqual([]);
  });

  it("تکراری‌ها یک‌بار گزارش می‌شوند", () => {
    const t = base({
      experience: [{ company: "X", bullets: ["30% faster", "another 30% gain"] }],
    });
    expect(findResumeGaps(t, [], EVIDENCE).ungroundedFigures).toEqual(["30%"]);
  });

  it("بدونِ سابقه، هیچ عددی ساختگی اعلام نمی‌شود (مثبتِ کاذب نسازیم)", () => {
    expect(findResumeGaps(withPct("30%"), []).ungroundedFigures).toEqual([]);
  });

  it("عددِ ساختگی ترمیم را لازم می‌کند", () => {
    expect(needsRepair(findResumeGaps(withPct("30%"), [], EVIDENCE))).toBe(true);
  });

  it("پیامِ ترمیم عددِ ساختگی را نام می‌برد", () => {
    const s = buildRepairInstruction(findResumeGaps(withPct("30%"), [], EVIDENCE), "en");
    expect(s).toContain("30%");
  });
});
