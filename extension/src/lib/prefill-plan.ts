/**
 * Form pre-fill PLANNING (pure logic).
 *
 * Given an apply queue item, produce a list of {selectorCandidates, value, label}
 * instructions. The content script walks these and fills matching fields — but
 * NEVER clicks submit. The plan is pure data, so it is fully unit-testable; the
 * DOM mutation is the only impure part and lives in the content script.
 *
 * LEGITIMACY RULE 2: pre-fill is assistive only. There is intentionally NO
 * "submit" step in the plan — the submit button stays under the user's finger.
 */
import type { ApplyQueueItem } from "@ext/lib/types";

export interface PrefillField {
  /** Human label shown in the approval UI ("cover letter", "answer: …"). */
  label: string;
  /** CSS selectors to try, in priority order, to locate the field. */
  selectorCandidates: string[];
  /** The text to place into the field (AI-drafted, user-reviewable). */
  value: string;
}

export interface PrefillPlan {
  jobUrl: string;
  fields: PrefillField[];
}

/** Selectors most Iranian job-board apply forms use for the cover/message box. */
const COVER_LETTER_SELECTORS = [
  'textarea[name*="cover" i]',
  'textarea[name*="message" i]',
  'textarea[name*="description" i]',
  'textarea[id*="cover" i]',
  'textarea[id*="message" i]',
  "textarea",
];

/** Build a deterministic pre-fill plan from a queue item. */
export function buildPrefillPlan(item: ApplyQueueItem): PrefillPlan {
  const fields: PrefillField[] = [];

  if (item.coverLetter?.trim()) {
    fields.push({
      label: "انگیزه‌نامه",
      selectorCandidates: [...COVER_LETTER_SELECTORS],
      value: item.coverLetter.trim(),
    });
  }

  for (const [i, qa] of (item.screeningAnswers ?? []).entries()) {
    if (!qa.answer?.trim()) continue;
    fields.push({
      label: `پاسخ: ${qa.question}`.slice(0, 80),
      selectorCandidates: [
        `[data-question="${cssEscape(qa.question)}"] textarea`,
        `[data-question="${cssEscape(qa.question)}"] input`,
        `textarea[name="answer_${i}"]`,
        `input[name="answer_${i}"]`,
      ],
      value: qa.answer.trim(),
    });
  }

  return { jobUrl: item.jobUrl, fields };
}

/** Minimal CSS attribute-value escaping for the question selectors above. */
export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
