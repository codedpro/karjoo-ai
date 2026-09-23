/**
 * One résumé, one language. The cases here are taken from a real résumé that
 * went out mixed: English layout and bullets under a Persian headline, Persian
 * job titles and Persian role summaries.
 */
import { describe, expect, it } from "vitest";

import type { ResumeTailorOutput } from "@/lib/ai/schema";
import {
  buildLanguageRepairInstruction,
  findLanguageViolations,
  isWrongLanguage,
  stripLanguageViolations,
} from "@/lib/resume/language-guard";

const PERSIAN_TITLE = "کارشناس استقرار و راه‌اندازی باشگاه مشتریان";

/** The shape of the résumé that was actually sent. */
function mixed(): ResumeTailorOutput {
  return {
    headline: PERSIAN_TITLE,
    summary: "Customer-club deployment specialist with Payam Gostar experience.",
    skills: ["Payam Gostar", "Next.js", "PostgreSQL"],
    experience: [
      {
        company: "CodeNest",
        title: PERSIAN_TITLE,
        period: "2019 – 2021",
        context: "در این نقش، به طراحی و توسعه سیستم‌های مبتنی بر وب پرداختم.",
        bullets: [
          "ایجاد و بهینه‌سازی گردش‌کارها با استفاده از Next.js",
          "Design reports and report generators that improved decision-making.",
        ],
      },
    ],
    highlights: ["توانایی تحلیل نیازمندی‌ها", "Hands-on Payam Gostar configuration."],
  };
}

describe("isWrongLanguage", () => {
  it("English résumé: any Persian letter is wrong", () => {
    expect(isWrongLanguage(PERSIAN_TITLE, "en")).toBe(true);
    expect(isWrongLanguage("Worked with the باشگاه team", "en")).toBe(true);
    expect(isWrongLanguage("Design reports with Next.js", "en")).toBe(false);
  });

  it("Persian résumé: technology names inside Persian prose are fine", () => {
    expect(isWrongLanguage("ایجاد و بهینه‌سازی گردش‌کارها با استفاده از Next.js", "fa")).toBe(false);
    expect(isWrongLanguage("Design reports and report generators.", "fa")).toBe(true);
  });

  it("does not count Persian digits as Persian text", () => {
    // A year written ۱۴۰۲ beside English text must not flag the whole line.
    expect(isWrongLanguage("Led the migration in ۱۴۰۲", "en")).toBe(false);
  });

  it("empty fields are never violations", () => {
    expect(isWrongLanguage("", "en")).toBe(false);
    expect(isWrongLanguage(undefined, "fa")).toBe(false);
  });
});

describe("findLanguageViolations", () => {
  it("finds every mixed field of the real résumé, and only those", () => {
    const paths = findLanguageViolations(mixed(), "en").map((v) => v.path);
    expect(paths).toEqual([
      "headline",
      "highlights[0]",
      "experience[0].title",
      "experience[0].context",
      "experience[0].bullets[0]",
    ]);
  });

  it("never flags company names, skills or periods", () => {
    const r = mixed();
    r.experience[0]!.company = "ایران مارکت";
    r.skills = ["پیام گستر"];
    const paths = findLanguageViolations(r, "en").map((v) => v.path);
    expect(paths.some((p) => p.includes("company") || p.startsWith("skills"))).toBe(false);
  });

  it("a Persian résumé flags the English fields instead", () => {
    const paths = findLanguageViolations(mixed(), "fa").map((v) => v.path);
    expect(paths).toContain("summary");
    expect(paths).toContain("experience[0].bullets[1]");
    expect(paths).not.toContain("headline");
  });
});

describe("buildLanguageRepairInstruction", () => {
  it("asks for English IN English — a Persian prompt pulls a Persian answer", () => {
    const text = buildLanguageRepairInstruction(findLanguageViolations(mixed(), "en"), "en");
    expect(text.startsWith("These fields are not in English")).toBe(true);
    expect(text).toContain("experience[0].title");
  });

  it("asks for Persian in Persian", () => {
    const text = buildLanguageRepairInstruction(findLanguageViolations(mixed(), "fa"), "fa");
    expect(text.startsWith("این فیلدها فارسی نیستند")).toBe(true);
  });
});

describe("stripLanguageViolations — the last resort", () => {
  it("leaves nothing mixed behind", () => {
    const cleaned = stripLanguageViolations(mixed(), "en", {
      headline: PERSIAN_TITLE, // a wrong-language fallback must not be used either
      titles: ["Full-stack Engineer"],
    });
    expect(findLanguageViolations(cleaned, "en")).toEqual([]);
  });

  it("falls back to the user's own role title when it is in the right language", () => {
    const cleaned = stripLanguageViolations(mixed(), "en", { titles: ["Full-stack Engineer"] });
    expect(cleaned.experience[0]!.title).toBe("Full-stack Engineer");
  });

  it("keeps everything that was already right", () => {
    const cleaned = stripLanguageViolations(mixed(), "en");
    expect(cleaned.summary).toBe(mixed().summary);
    expect(cleaned.experience[0]!.bullets).toEqual([
      "Design reports and report generators that improved decision-making.",
    ]);
    expect(cleaned.highlights).toEqual(["Hands-on Payam Gostar configuration."]);
    expect(cleaned.skills).toEqual(mixed().skills);
  });
});
