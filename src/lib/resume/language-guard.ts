import "server-only";

/**
 * One résumé, one language.
 *
 * A tailored résumé was going out with an English layout, English section
 * headings and English bullets — under a PERSIAN headline, Persian job titles and
 * Persian role summaries, with each role opening on Persian bullets and ending on
 * English ones. An employer reading that sees a document stitched together by a
 * machine, which is the one impression a job application must never give.
 *
 * The prompt already said "the whole output in the résumé language; if English,
 * not a single Persian sentence". The model broke it anyway: another rule told it
 * to use the ad's exact title as the headline (the ad was Persian), and the repair
 * passes — themselves written in Persian — told it to "rewrite the titles with
 * this JD". A sentence in a prompt is a request. So this module ENFORCES it after
 * generation, on every field the model writes:
 *
 *   1. find the prose fields in the wrong language;
 *   2. the caller sends ONLY those back to be translated;
 *   3. anything still wrong afterwards is removed rather than shipped mixed.
 *
 * Deliberately exempt: company names, skills and periods. Those are proper nouns
 * and technology names ("Payam Gostar", "Next.js", "2019 – 2021") and read the
 * same in either language.
 */
import type { ResumeTailorOutput } from "@/lib/ai/schema";

export type ResumeLang = "en" | "fa";

const PERSIAN_LETTERS = /[؀-ۿﭐ-﷿ﹰ-﻿]/g;
/** Eastern digits sit inside the Persian block but say nothing about the language. */
const EASTERN_DIGITS = /[٠-٩۰-۹]/g;
const LATIN_LETTERS = /[A-Za-z]/g;

function counts(text: string): { persian: number; latin: number } {
  const clean = text.replace(EASTERN_DIGITS, "");
  return {
    persian: (clean.match(PERSIAN_LETTERS) ?? []).length,
    latin: (clean.match(LATIN_LETTERS) ?? []).length,
  };
}

/**
 * PURE: is this piece of prose in the wrong language for the résumé?
 *
 *   • English résumé — ANY Persian letter is wrong. The rule the model was given
 *     was "not a single Persian sentence"; a half-Persian bullet is exactly the
 *     failure being fixed.
 *   • Persian résumé — wrong when Latin letters OUTNUMBER Persian ones. A Persian
 *     sentence legitimately names React or PostgreSQL; an English sentence with a
 *     Persian word in it is still an English sentence.
 */
export function isWrongLanguage(text: string | null | undefined, lang: ResumeLang): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  const { persian, latin } = counts(value);
  if (lang === "en") return persian > 0;
  return latin > persian;
}

/** A field in the wrong language, addressed by its JSON path. */
export interface LanguageViolation {
  path: string;
  text: string;
}

/** PURE: every prose field of a tailored résumé that is in the wrong language. */
export function findLanguageViolations(
  resume: ResumeTailorOutput,
  lang: ResumeLang,
): LanguageViolation[] {
  const out: LanguageViolation[] = [];
  const check = (path: string, text: string | null | undefined) => {
    if (isWrongLanguage(text, lang)) out.push({ path, text: String(text) });
  };
  check("headline", resume.headline);
  check("summary", resume.summary);
  resume.highlights?.forEach((h, i) => check(`highlights[${i}]`, h));
  resume.experience.forEach((role, r) => {
    check(`experience[${r}].title`, role.title);
    check(`experience[${r}].context`, role.context);
    role.bullets.forEach((b, i) => check(`experience[${r}].bullets[${i}]`, b));
  });
  return out;
}

/**
 * The instruction for the one translation pass — written IN the target language.
 * Asking for English in Persian is part of how the model got here: a Persian
 * prompt pulls a Persian answer.
 */
export function buildLanguageRepairInstruction(
  violations: LanguageViolation[],
  lang: ResumeLang,
): string {
  const list = violations.map((v) => `- ${v.path}: ${v.text}`).join("\n");
  if (lang === "en") {
    return [
      "These fields are not in English. The whole résumé must be in English.",
      "Translate ONLY these fields into natural, professional English. Keep their meaning,",
      "keep every other field exactly as it is, keep company names and technology names",
      "as they are, and do not add anything new.",
      "",
      list,
    ].join("\n");
  }
  return [
    "این فیلدها فارسی نیستند. کلِ رزومه باید فارسی باشد.",
    "فقط همین فیلدها را به فارسیِ روان و حرفه‌ای برگردان. معنا را حفظ کن، بقیه‌ی فیلدها را",
    "دست نزن، نامِ شرکت‌ها و فناوری‌ها (مثلِ React) را همان‌طور نگه دار و چیزی اضافه نکن.",
    "",
    list,
  ].join("\n");
}

/**
 * PURE: last resort — remove whatever is STILL in the wrong language.
 *
 * A résumé a little shorter than planned is better than one that switches
 * language mid-sentence. Bullets, highlights and context lines are dropped; a
 * wrong-language role title falls back to the user's own title for that role
 * (if it is in the right language) or is left blank; the headline falls back to
 * the given replacement or is cleared. The summary is kept only if it passes.
 */
export function stripLanguageViolations(
  resume: ResumeTailorOutput,
  lang: ResumeLang,
  fallbacks: { headline?: string | null; titles?: (string | null | undefined)[] } = {},
): ResumeTailorOutput {
  const ok = (text: string | null | undefined) => !isWrongLanguage(text, lang);
  const pick = (candidate: string | null | undefined): string | undefined =>
    candidate && ok(candidate) ? candidate : undefined;

  return {
    ...resume,
    headline: ok(resume.headline) ? resume.headline : (pick(fallbacks.headline) ?? ""),
    summary: ok(resume.summary) ? resume.summary : "",
    highlights: resume.highlights?.filter(ok),
    experience: resume.experience.map((role, r) => ({
      ...role,
      title: ok(role.title) ? role.title : pick(fallbacks.titles?.[r]),
      context: ok(role.context) ? role.context : undefined,
      bullets: role.bullets.filter(ok),
    })),
  };
}
