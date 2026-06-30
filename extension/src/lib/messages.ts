/**
 * Typed message contracts for chrome.runtime messaging.
 *
 * Three runtimes talk here:
 *   • popup        — user-facing UI
 *   • background   — service worker (owns the session token + API client)
 *   • content      — per-board scripts (probe local session, pre-fill forms)
 *
 * The background worker is the ONLY holder of the Karjoo session token. The
 * popup never reads the token directly; it asks the background to act. Content
 * scripts NEVER see the Karjoo token nor any third-party credential payload.
 */
import type { BoardId } from "@ext/lib/config";
import type {
  ApplyQueueItem,
  ApplyResultReport,
  AutoApplySettings,
  AutoApplyStatus,
} from "@ext/lib/types";
import type { ScrapeProfileResult, BoardImportOutcome } from "@ext/lib/import-types";
import type { ApplyPlan } from "@ext/lib/apply-runner";
import type { CapturedStorage } from "@ext/lib/session-snapshot";

/* ── popup → background ─────────────────────────────────────────────────── */

export interface PairMsg {
  type: "PAIR";
  /** One-time pairing code the user pasted from the Karjoo dashboard. */
  code: string;
}

export interface GetIdentityMsg {
  type: "GET_IDENTITY";
}

export interface SignOutMsg {
  type: "SIGN_OUT";
}

export interface SetApiOriginMsg {
  type: "SET_API_ORIGIN";
  origin: string;
}

export interface DetectBoardMsg {
  type: "DETECT_BOARD";
  board: BoardId;
}

export interface ConnectBoardMsg {
  type: "CONNECT_BOARD";
  board: BoardId;
  /** Optional human-friendly label, e.g. "my main account". NEVER a credential. */
  accountLabel?: string;
}

export interface ClaimQueueMsg {
  type: "CLAIM_QUEUE";
}

export interface PrefillMsg {
  type: "PREFILL";
  item: ApplyQueueItem;
}

export interface ReportResultMsg {
  type: "REPORT_RESULT";
  report: ApplyResultReport;
}

/**
 * Ask the background worker to import the user's OWN profile DATA from one or
 * more boards. For each board the worker opens the user's profile page, asks the
 * content script to scrape DATA (never credentials), builds the DATA-only
 * payload, and POSTs it to /api/profile/import. (User-present, user-approved.)
 */
export interface ImportProfilesMsg {
  type: "IMPORT_PROFILES";
  /** Which boards to import from. Omit/empty → all configured boards. */
  boards?: BoardId[];
}

/** Popup → background: read the auto-apply settings (server-authoritative). */
export interface GetAutoApplyMsg {
  type: "GET_AUTO_APPLY";
}

/** Popup → background: set the auto-apply toggle / threshold (explicit consent). */
export interface SetAutoApplyMsg {
  type: "SET_AUTO_APPLY";
  enabled: boolean;
  minScore?: number;
}

/** Popup → background: read the last background-tick status (for the "last run" view). */
export interface GetAutoApplyStatusMsg {
  type: "GET_AUTO_APPLY_STATUS";
}

/** Popup → background: trigger one background auto-apply tick now (manual "run"). */
export interface RunAutoApplyNowMsg {
  type: "RUN_AUTO_APPLY_NOW";
}

/* ── background → content ──────────────────────────────────────────────── */

/** Ask a content script whether the user is logged in on this board, locally. */
export interface ProbeSessionMsg {
  type: "PROBE_SESSION";
  board: BoardId;
}

/** Ask a content script to pre-fill (NOT submit) the application form. */
export interface ContentPrefillMsg {
  type: "CONTENT_PREFILL";
  item: ApplyQueueItem;
}

/**
 * Ask a board's import content script to scrape the user's OWN profile DATA from
 * the current page. The content script replies with a ScrapeProfileResult that
 * carries DATA only — NEVER a cookie/token/session/credential (RULE 1).
 */
export interface ScrapeProfileMsg {
  type: "SCRAPE_PROFILE";
  board: BoardId;
}

/**
 * Background → apply content script: execute a resolved APPLY_SPEC plan on the
 * current board page (auto-apply). Sent ONLY after the background runner verified
 * the toggle is ON, the daily cap is not reached, and the item is above
 * threshold. The content script drives the public form (fill + submit) using the
 * user's own session; it does NOT decide on its own to apply (§10).
 */
export interface ContentApplyMsg {
  type: "CONTENT_APPLY";
  plan: ApplyPlan;
}

/**
 * Background → session-probe content script: capture the user's OWN
 * localStorage/sessionStorage for THIS board so the local session snapshot stays
 * fresh (and, premium only, can be pushed to the user's own vault). The probe
 * returns key→value pairs; this is RAW session material and is handled like the
 * cookies — kept LOCAL unless the user is premium, never to any endpoint except
 * /api/session/refresh (the user's own vault).
 */
export interface CaptureStorageMsg {
  type: "CAPTURE_STORAGE";
  board: BoardId;
}

export type PopupToBackground =
  | PairMsg
  | GetIdentityMsg
  | SignOutMsg
  | SetApiOriginMsg
  | DetectBoardMsg
  | ConnectBoardMsg
  | ClaimQueueMsg
  | PrefillMsg
  | ReportResultMsg
  | ImportProfilesMsg
  | GetAutoApplyMsg
  | SetAutoApplyMsg
  | GetAutoApplyStatusMsg
  | RunAutoApplyNowMsg;

export type BackgroundToContent =
  | ProbeSessionMsg
  | ContentPrefillMsg
  | ScrapeProfileMsg
  | ContentApplyMsg
  | CaptureStorageMsg;

/** Subset of background→content messages the IMPORT content scripts handle. */
export type BackgroundToImportContent = ScrapeProfileMsg;

/* ── responses ─────────────────────────────────────────────────────────── */

export interface ProbeSessionResult {
  /** Whether the user appears logged into the board IN THEIR OWN BROWSER. */
  loggedIn: boolean;
  /**
   * SAFETY: this NEVER includes the cookie value / token / password. It is a
   * boolean (+ optional non-secret label hint, e.g. a display name shown by the
   * site). The raw secret never leaves the browser.
   */
  accountLabelHint?: string;
}

export interface PrefillResult {
  ok: boolean;
  /** Which fields were filled (for the approval UI), never their secret values. */
  filledFields: string[];
  message?: string;
}

/** Result of a CONTENT_APPLY (auto-apply execution) — non-secret summary only. */
export interface ContentApplyResult {
  ok: boolean;
  /** Non-secret debug trail of which steps ran. */
  ranSteps: string[];
  /** Short, non-secret reason on failure. */
  reason?: string;
}

/** Result of a CAPTURE_STORAGE probe — RAW storage k/v (handled like cookies). */
export interface CaptureStorageResult {
  storage: CapturedStorage;
}

/** Re-exported so consumers import message + import contracts from one place. */
export type { ScrapeProfileResult, BoardImportOutcome };
export type { AutoApplySettings, AutoApplyStatus };

/** Generic ok/err envelope used by background → popup responses. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
