/**
 * Queue rendering helpers (pure logic, framework-free).
 *
 * Turn an ApplyQueueItem into the strings/flags the popup needs to render a
 * review card. Kept pure so it can be unit-tested without a DOM, and so the UI
 * layer stays a thin binding over tested logic.
 *
 * IMPORTANT: nothing here auto-submits. The view always exposes the fact that a
 * human must click "Approve & submit" (LEGITIMACY RULE 2). `canSubmit` only ever
 * gates the button's enabled state; it never performs a submit.
 */
import { BOARDS } from "@ext/lib/config";
import type { ApplyQueueItem } from "@ext/lib/types";

export interface QueueCardView {
  id: string;
  title: string;
  /** "company · city" style subtitle, with present parts only. */
  subtitle: string;
  boardLabel: string;
  jobUrl: string;
  coverLetter: string;
  coverLetterPreview: string;
  screening: { question: string; answer: string }[];
  /** "۸۷٪" style Persian-digit match label, or null when no score. */
  matchLabel: string | null;
  /** Whether the card is renderable/actionable (has the minimum fields). */
  canSubmit: boolean;
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Convert ASCII digits in a string to Persian digits (display only). */
export function toPersianDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]!);
}

/** Format a 0..1 match score as a Persian-digit percentage, e.g. 0.87 → "۸۷٪". */
export function formatMatchScore(score: number | undefined): string | null {
  if (score === undefined || Number.isNaN(score)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  return `${toPersianDigits(String(pct))}٪`;
}

/** Truncate a cover letter for the collapsed card view (preserves whole words). */
export function previewCoverLetter(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/** Build the subtitle from optional company/city, joining present parts with " · ". */
export function buildSubtitle(item: Pick<ApplyQueueItem, "company" | "city">): string {
  return [item.company, item.city].filter((p): p is string => Boolean(p && p.trim())).join(" · ");
}

/** Map a board id to its Persian display label (falls back to the id). */
export function boardLabel(board: ApplyQueueItem["board"]): string {
  return BOARDS[board]?.displayName ?? board;
}

/** Project a raw queue item into a render-ready card view. */
export function toQueueCardView(item: ApplyQueueItem): QueueCardView {
  return {
    id: item.id,
    title: item.jobTitle,
    subtitle: buildSubtitle(item),
    boardLabel: boardLabel(item.board),
    jobUrl: item.jobUrl,
    coverLetter: item.coverLetter,
    coverLetterPreview: previewCoverLetter(item.coverLetter),
    screening: item.screeningAnswers ?? [],
    matchLabel: formatMatchScore(item.matchScore),
    canSubmit: Boolean(item.id && item.jobUrl && item.coverLetter),
  };
}

/** Project a whole queue, dropping malformed items defensively. */
export function toQueueCardViews(items: ApplyQueueItem[]): QueueCardView[] {
  return items.filter((i) => i && i.id).map(toQueueCardView);
}
