/**
 * تست‌های اسکیماهای zod خروجی مدل — بدون شبکه.
 */
import { describe, expect, it } from "vitest";

import {
  coverLetterSchema,
  matchScoreSchema,
  scoreAndDraftSchema,
} from "@/lib/ai/schema";

describe("matchScoreSchema", () => {
  it("خروجی معتبر را می‌پذیرد", () => {
    const r = matchScoreSchema.safeParse({
      matchScore: 0.73,
      reasons: ["تطبیق مهارت‌ها", "هم‌شهری"],
    });
    expect(r.success).toBe(true);
  });

  it("امتیاز خارج از بازه‌ی ۰..۱ را رد می‌کند", () => {
    expect(matchScoreSchema.safeParse({ matchScore: 1.5, reasons: ["x"] }).success).toBe(false);
    expect(matchScoreSchema.safeParse({ matchScore: -0.1, reasons: ["x"] }).success).toBe(false);
  });

  it("امتیاز غیرعددی را رد می‌کند", () => {
    expect(matchScoreSchema.safeParse({ matchScore: "0.5", reasons: ["x"] }).success).toBe(false);
  });

  it("نبود reasons را با آرایه‌ی خالی پر می‌کند (default)", () => {
    const r = matchScoreSchema.safeParse({ matchScore: 0.5 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasons).toEqual([]);
  });
});

describe("coverLetterSchema", () => {
  it("متن غیرخالی را می‌پذیرد و trim می‌کند", () => {
    const r = coverLetterSchema.safeParse({ coverLetter: "  سلام، اینجانب…  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.coverLetter).toBe("سلام، اینجانب…");
  });

  it("متن خالی را رد می‌کند", () => {
    expect(coverLetterSchema.safeParse({ coverLetter: "   " }).success).toBe(false);
    expect(coverLetterSchema.safeParse({}).success).toBe(false);
  });
});

describe("scoreAndDraftSchema", () => {
  it("خروجی ترکیبی معتبر را می‌پذیرد", () => {
    const r = scoreAndDraftSchema.safeParse({
      matchScore: 0.9,
      reasons: ["تسلط بر React"],
      coverLetter: "با سلام و احترام…",
    });
    expect(r.success).toBe(true);
  });

  it("نبودِ coverLetter را رد می‌کند", () => {
    const r = scoreAndDraftSchema.safeParse({ matchScore: 0.9, reasons: ["x"] });
    expect(r.success).toBe(false);
  });
});
