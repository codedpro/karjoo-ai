import type { JobBoardId } from "@/lib/apply/types";

const SUBMISSION_PROOF_SIGNALS = {
  jobinja: new Set([
    "flash_message",
    "submitted_text",
    "apply_form_removed",
    "already_applied_text",
    "application_history",
  ]),
  jobvision: new Set([
    "post_apply_path",
    "submitted_text",
    "already_applied_text",
  ]),
  "e-estekhdam": new Set([
    "apply_api_accepted",
    "apply_after_cleanup_api_accepted",
    "already_applied_api",
  ]),
  irantalent: new Set([
    "position_is_applied",
    "conditions_is_applied",
    "apply_conflict",
    "application_history",
  ]),
  karboom: new Set([
    "wizard_done",
    "already_applied_response",
  ]),
} as const satisfies Partial<Record<JobBoardId, ReadonlySet<string>>>;

export function isValidSubmissionProof(
  board: string,
  proof: Record<string, unknown> | undefined,
): boolean {
  if (!proof || proof.provider !== board || typeof proof.signal !== "string") return false;
  const signals = SUBMISSION_PROOF_SIGNALS[board as keyof typeof SUBMISSION_PROOF_SIGNALS];
  return Boolean(signals?.has(proof.signal as never));
}

export function hasSubmissionEvidence(input: {
  board: string;
  externalRef?: string;
  proof?: Record<string, unknown>;
}): boolean {
  return Boolean(input.externalRef?.trim()) || isValidSubmissionProof(input.board, input.proof);
}
