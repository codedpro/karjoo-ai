/**
 * Board session SHAPE metadata (pure logic).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1: nothing here returns, logs, or forwards a cookie value or
 * token. The secret stays in the browser, owned by the site.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This module used to decide "is the user logged in?" by matching cookie and
 * localStorage KEY NAMES. That was wrong, and it shipped a real bug: Jobinja
 * hands its `JSESSID` cookie to ANONYMOUS visitors too, so the name match said
 * "signed in" for anyone who had merely opened jobinja.ir. Every active provider
 * now uses a board-specific AUTHENTICATED identity probe instead — it asks the
 * board itself (see background/service-worker.ts and lib/irantalent-session.ts).
 *
 * What remains here is the session SHAPE each board uses, which the session
 * refresh path still needs:
 *
 *   • cookie → Jobinja, e-estekhdam, IranTalent (a first-party cookie).
 *   • token  → JobVision (a JWT in localStorage).
 */
import type { BoardId } from "@ext/lib/config";

/**
 * JobVision (SPA) localStorage key candidates that hold the auth JWT. Used to
 * decide WHICH keys a content script should look for — presence only, never the
 * value. This is a capture hint, not a login decision.
 */
const JOBVISION_TOKEN_KEYS = [
  "CandidateClient_v2",
  "token",
  "access_token",
  "auth_token",
  "jv_token",
  "userToken",
];

/**
 * Decide whether JobVision auth token keys are present in the reported key set.
 * Input is the LIST OF localStorage KEY NAMES the content script found — never
 * the token values. JobVision only writes these once a candidate has signed in,
 * so unlike Jobinja's cookie their presence really does mean a session exists.
 */
export function jobvisionLoggedIn(localStorageKeys: string[]): boolean {
  const lower = localStorageKeys.map((k) => k.toLowerCase());
  return JOBVISION_TOKEN_KEYS.some((k) => lower.includes(k.toLowerCase()));
}

/** localStorage key candidates a content script should probe for (presence only). */
export function sessionTokenKeys(board: BoardId): string[] {
  if (board === "jobvision") return [...JOBVISION_TOKEN_KEYS];
  return [];
}

/**
 * Whether a board's login lives in a cookie or a localStorage token. JobVision is
 * the only token-shaped board; IranTalent is an SPA but keeps its OAuth envelope
 * in a first-party cookie (`auth_token_irantalent_new`).
 */
export function sessionShapeOf(board: BoardId): "cookie" | "token" {
  return board === "jobvision" ? "token" : "cookie";
}
