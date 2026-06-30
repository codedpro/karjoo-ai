/**
 * APPLY_SPEC-driven plan builder — MIRRORS the extension's apply-runner
 * (extension/src/lib/apply-runner.ts buildApplyPlan). Resolves each spec step's
 * `valueKey` into a literal from the user's drafted data (coverLetter, etc.).
 *
 * §10: the plan is APPLY_SPEC selectors filled with the user's OWN data — no
 * detection-evasion. Optional steps with no value are dropped; a REQUIRED fill
 * with no value is KEPT so the executor records a failure instead of silently
 * submitting a half-form.
 */
import {
  getApplySpec,
  type ApplyStep,
  type ApplyValueKey,
  type BoardApplySpec,
} from "./apply-spec.js";
import type { FleetJob } from "./types.js";

/** A resolved step: the spec step plus the literal value to inject (if any). */
export interface ResolvedApplyStep extends ApplyStep {
  value?: string;
}

/** The per-job plan handed to the executor. */
export interface ApplyPlan {
  board: string;
  jobUrl: string;
  /** Maturity of the spec — "scaffold" boards are best-effort-only (runner refuses submit). */
  maturity: "best-effort" | "scaffold";
  steps: ResolvedApplyStep[];
  /** The submit selector (so the executor can verify the result). */
  submitSelector: string;
  confirmSelector?: string;
}

/** The values the runner can inject into fill/select/upload steps. */
export type ApplyValues = Partial<Record<ApplyValueKey, string>>;

/** Resolve the standard value map for a job (cover letter for now). */
export function applyValuesFor(job: Pick<FleetJob, "coverLetter">): ApplyValues {
  const values: ApplyValues = {};
  if (job.coverLetter?.trim()) values.coverLetter = job.coverLetter.trim();
  return values;
}

/**
 * Build the APPLY_SPEC-driven plan for one job. Returns null when the board has no
 * spec (caller skips the job).
 */
export function buildApplyPlan(
  job: Pick<FleetJob, "board" | "listingUrl" | "coverLetter">,
  values: ApplyValues = applyValuesFor(job),
): ApplyPlan | null {
  const spec: BoardApplySpec | undefined = getApplySpec(job.board);
  if (!spec) return null;

  const steps: ResolvedApplyStep[] = [];
  for (const step of spec.steps) {
    if (step.kind === "fill" || step.kind === "select" || step.kind === "upload") {
      const value = step.valueKey ? values[step.valueKey] : undefined;
      if (value === undefined && step.optional) continue; // optional + no value → drop
      steps.push(value !== undefined ? { ...step, value } : { ...step });
    } else {
      steps.push({ ...step });
    }
  }

  return {
    board: job.board,
    jobUrl: job.listingUrl,
    maturity: spec.maturity,
    steps,
    submitSelector: spec.submitSelector,
    confirmSelector: spec.confirmSelector,
  };
}
