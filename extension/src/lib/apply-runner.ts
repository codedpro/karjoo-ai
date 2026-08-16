/**
 * Background auto-apply RUNNER — pure decision + planning core.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 GUARDRAILS LIVE HERE (and are unit-tested):
 *   • NEVER applies when the auto-apply toggle is OFF. The toggle is the user's
 *     explicit, revocable consent; with it off, `decideTick()` returns "disabled"
 *     and the runner does nothing.
 *   • NEVER applies past the daily cap. The server is the source of truth: the
 *     claim endpoint returns `reason: 'quota_exceeded'` (or an empty queue) and
 *     the result endpoint returns HTTP 429 when the cap is hit. Either signal
 *     STOPS the drain immediately for this tick (`shouldStopForCap`).
 *   • Match-quality threshold is enforced SERVER-SIDE (claim only returns
 *     above-threshold items). The runner additionally refuses any item whose
 *     score is below the effective minScore as defense in depth.
 *   • Politeness throttle + jitter between applies (delay computed by
 *     auto-apply-config.politenessDelayMs; the runner just sequences it).
 *   • No detection-evasion. The plan is APPLY_SPEC selectors filled with the
 *     user's OWN drafted data, submitted in the user's OWN browser session.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This module is PURE (no chrome.*, no DOM, no network). The background service
 * worker provides the impure adapters (fetch the toggle, claim, drive the content
 * script, report the result). That keeps the guardrails fully testable.
 */
import type { ApplyQueueItem } from "@ext/lib/types";
import { getApplySpec, type ApplyStep, type ApplyValueKey } from "@ext/lib/apply-spec";

/* ── tick decision (the toggle gate) ───────────────────────────────────────── */

/** The server-mirrored auto-apply settings the worker fetched this tick. */
export interface AutoApplyGate {
  /** The user's explicit consent toggle. OFF → nothing runs. */
  enabled: boolean;
  /** Effective match-quality threshold (server default 0.7). */
  minScore: number;
  /** Whether the user has at least one connected board (else nothing to apply on). */
  boardsConnected: boolean;
}

export type TickDecision =
  | { run: true; minScore: number }
  | { run: false; reason: "disabled" | "no_boards" };

/**
 * Decide whether this alarm tick may run at all. This is the FIRST guardrail:
 * with the toggle OFF (or no connected boards) the runner returns run:false and
 * the background worker drains NOTHING. The toggle being ON is necessary but not
 * sufficient — the daily cap + threshold still gate every individual apply.
 */
export function decideTick(gate: AutoApplyGate): TickDecision {
  if (!gate.enabled) return { run: false, reason: "disabled" };
  if (!gate.boardsConnected) return { run: false, reason: "no_boards" };
  return { run: true, minScore: gate.minScore };
}

/* ── claim-response interpretation (cap / disabled signals) ────────────────── */

/** Shape the claim endpoint returns (mirrors the control-plane contract). */
export interface ClaimOutcome {
  items: ApplyQueueItem[];
  /** Present only when the server returned an empty, gated queue. */
  reason?: "disabled" | "quota_exceeded";
}

/**
 * Decide whether a claim outcome means "stop this tick" (cap reached or the
 * toggle was flipped off between fetch and claim). Either way: do nothing more.
 */
export function shouldStopForClaim(outcome: ClaimOutcome): boolean {
  return outcome.reason === "quota_exceeded" || outcome.reason === "disabled";
}

/* ── per-item filtering (threshold defense in depth) ───────────────────────── */

/**
 * Keep only items the runner is allowed to auto-apply to:
 *   • The board must have an APPLY_SPEC (else there is no way to fill/submit).
 *   • The score must be ≥ minScore. An item with NO score is NEVER auto-applied
 *     (matches the server: NULL-score listings never auto-apply).
 * The server already filters by threshold; this is belt-and-suspenders.
 */
export function eligibleItems(items: ApplyQueueItem[], minScore: number): ApplyQueueItem[] {
  return items.filter((it) => {
    if (!getApplySpec(it.board)) return false;
    if (typeof it.matchScore !== "number") return false;
    return it.matchScore >= minScore;
  });
}

/* ── result-status interpretation (HTTP 429 = cap) ─────────────────────────── */

/** Outcome of POSTing a result, as the background worker observed it. */
export interface ResultOutcome {
  ok: boolean;
  /** HTTP status (so we can detect the 429 daily-cap signal). */
  status: number;
}

/** A result POST that returned 429 means the daily cap is reached → stop draining. */
export function shouldStopForCap(outcome: ResultOutcome): boolean {
  return outcome.status === 429;
}

/* ── APPLY_SPEC-driven fill plan (what the content script executes) ─────────── */

/** A resolved step: the spec step plus the literal value to inject (if any). */
export interface ResolvedApplyStep extends ApplyStep {
  /** The literal value for fill/select steps (resolved from `values`). Omitted otherwise. */
  value?: string;
  fileName?: string;
}

/** The per-item plan handed to the content-script executor. */
export interface ApplyPlan {
  board: ApplyQueueItem["board"];
  jobUrl: string;
  jobTitle: string;
  /** Maturity of the spec used — "scaffold" boards are best-effort only. */
  maturity: "best-effort" | "scaffold";
  steps: ResolvedApplyStep[];
}

/** The values the runner can inject into fill/select/upload steps. */
export type ApplyValues = Partial<Record<ApplyValueKey, string>>;

/**
 * Build the APPLY_SPEC-driven plan for one queue item. Resolves each step's
 * `valueKey` to a literal from `values` (e.g. coverLetter ← item.coverLetter).
 * Steps whose value is missing AND that are optional are dropped; a missing
 * value for a REQUIRED fill step keeps the step (the executor will record a
 * failure when it cannot fill it) so we never silently submit a half-form.
 *
 * Returns null when the board has no spec (caller skips the item).
 */
export function buildApplyPlan(item: ApplyQueueItem, values: ApplyValues): ApplyPlan | null {
  const spec = getApplySpec(item.board);
  if (!spec) return null;

  const steps: ResolvedApplyStep[] = [];
  for (const step of spec.steps) {
    // Conditional step: skip entirely unless the required value is present (per-job
    // custom résumé upload path only runs when a resumeFile exists).
    if (step.requiresValueKey && values[step.requiresValueKey] === undefined) continue;
    if (step.kind === "fill" || step.kind === "select" || step.kind === "upload") {
      const value = step.valueKey ? values[step.valueKey] : undefined;
      // Optional step with no value → skip it entirely (e.g. no cover letter field).
      if (value === undefined && step.optional) continue;
      steps.push(
        value !== undefined
          ? {
              ...step,
              value,
              ...(step.kind === "upload" && values.resumeFileName
                ? { fileName: values.resumeFileName }
                : {}),
            }
          : { ...step },
      );
    } else {
      steps.push({ ...step });
    }
  }

  return {
    board: item.board,
    jobUrl: item.jobUrl,
    jobTitle: item.jobTitle,
    maturity: spec.maturity,
    steps,
  };
}

/** Resolve text and the short-lived tailored-resume data URL for one item. */
export function applyValuesFor(item: ApplyQueueItem): ApplyValues {
  const values: ApplyValues = {};
  if (item.coverLetter?.trim()) values.coverLetter = item.coverLetter.trim();
  if (item.resume?.dataUrl) values.resumeFile = item.resume.dataUrl;
  if (item.resume?.fileName) values.resumeFileName = item.resume.fileName;
  return values;
}
