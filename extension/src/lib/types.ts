/**
 * Domain types shared across the extension, mirroring the Karjoo control-plane
 * contracts (src/lib/apply/types.ts and the apply-queue API). Kept intentionally
 * narrow — only what the UI needs to render and report.
 */
import type { BoardId } from "@ext/lib/config";

/** Signed-in identity returned by GET /api/extension/me. */
export interface Identity {
  userId: string;
  /** Masked phone for display, e.g. "0912***4567" — never the full number if maskable. */
  phone?: string;
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

/** Outcome the user's APPROVAL produces, POSTed to /api/apply-queue/:id/result. */
export interface ApplyResultReport {
  id: string;
  /** "submitted" only ever set after an explicit user "Approve & submit" click. */
  status: "submitted" | "skipped" | "failed";
  /** Optional proof/reference the board returned (e.g. confirmation id). */
  externalRef?: string;
  reason?: string;
}
