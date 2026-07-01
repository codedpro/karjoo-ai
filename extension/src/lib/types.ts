/**
 * Domain types shared across the extension, mirroring the Karjoo control-plane
 * contracts (src/lib/apply/types.ts and the apply-queue API). Kept intentionally
 * narrow — only what the UI needs to render and report.
 */
import type { BoardId } from "@ext/lib/config";

/** Signed-in identity returned by GET /api/extension/me. */
export interface Identity {
  userId: string;
  /** Google account email for display, e.g. "user@gmail.com". */
  email?: string;
  displayName?: string;
}

/** The metadata-only payload POSTed to /api/board-accounts/connect.
 *
 * LEGITIMACY RULE 1 (docs §10): ONLY a board id + status + optional label.
 * It is a TYPE ERROR to add a cookie/token/password/credential field here, and
 * `buildConnectPayload` asserts at runtime that no secret-shaped key sneaks in.
 */
export interface ConnectPayload {
  board: BoardId;
  status: "connected";
  accountLabel?: string;
}

/** A pre-filled, AI-drafted application the user can review and approve. */
export interface ApplyQueueItem {
  /** Application/task id used in /api/apply-queue/:id/result. */
  id: string;
  board: BoardId;
  jobTitle: string;
  company?: string;
  city?: string;
  /** The job posting URL — where the content script pre-fills the form. */
  jobUrl: string;
  /** AI-generated cover letter the user reviews before approving. */
  coverLetter: string;
  /** Optional structured answers to screening questions, drafted by AI. */
  screeningAnswers?: { question: string; answer: string }[];
  matchScore?: number;
}

/**
 * Outcome of an application, POSTed to /api/apply-queue/:id/result.
 *
 * "submitted" is set either by an explicit user "Approve & submit" (assisted
 * flow) OR by the background auto-apply runner after it successfully drove the
 * APPLY_SPEC submit step in the user's own browser (auto flow) — both gated by
 * §10 guardrails. "skipped"/"failed" record a non-submission.
 */
export interface ApplyResultReport {
  id: string;
  status: "submitted" | "skipped" | "failed";
  /** Optional proof/reference the board returned (e.g. confirmation id). */
  externalRef?: string;
  reason?: string;
}

/**
 * Auto-apply settings, mirrored from the server (the source of truth). The popup
 * toggles `enabled`; nothing auto-applies unless the server reports it ON.
 */
export interface AutoApplySettings {
  /** The explicit, revocable consent toggle. Default OFF. */
  enabled: boolean;
  /** Effective match-quality threshold (server default 0.7). */
  minScore: number;
}

/** Billing plan tier — decides whether the vaulted session push is offered. */
export type PlanTier = "free" | "pro" | "max" | "maxplus";

/** Whether a plan tier uses the server vault (Max/Max+) or stays device-local. */
export function planUsesVault(plan: PlanTier): boolean {
  return plan === "max" || plan === "maxplus";
}

/** Non-secret summary of the most recent background auto-apply tick (for the UI). */
export interface AutoApplyStatus {
  /** When the tick ran (ms epoch). */
  ranAt: number;
  /** Why the tick did or did not run / how it ended. */
  outcome:
    | "disabled" // toggle OFF — nothing ran
    | "no_boards" // toggle ON but no connected board
    | "not_paired" // extension not paired yet
    | "quota_reached" // server reported the daily cap
    | "empty" // ran, queue was empty
    | "applied" // ran, applied to ≥1 item
    | "error"; // ran, hit an error
  /** How many items were submitted this tick. */
  submitted: number;
  /** How many items failed/were skipped this tick. */
  failed: number;
  /** Optional short, non-secret message for the UI. */
  message?: string;
}
