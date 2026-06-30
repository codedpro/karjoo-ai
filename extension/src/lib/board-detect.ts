/**
 * Local board-session detection (pure logic).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1: these helpers decide ONLY a boolean — "does the user appear
 * logged into this board IN THEIR OWN BROWSER?" — from session-SHAPED signals.
 * They take cookie/localStorage KEY names (and at most a presence/length check),
 * and return true/false. They DELIBERATELY never return, log, or forward the
 * actual cookie value / token. The secret stays in the browser, owned by the site.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Jobinja  → auth lives in a session COOKIE → read key NAMES via chrome.cookies.
 * JobVision → SPA: auth is a JWT in localStorage → a content script reports which
 *             KEYS exist (never the value).
 */
import type { BoardId } from "@ext/lib/config";

/**
 * Jobinja session-cookie name candidates. Jobinja is a classic server-rendered
 * Laravel-style app, so the framework session cookie indicates a logged-in
 * session. We match by name only.
 */
const JOBINJA_SESSION_COOKIE_NAMES = [
  "jobinja_session",
  "laravel_session",
  "remember_web",
  "PHPSESSID",
];

/**
 * e-estekhdam session-cookie name candidates. Also a server-rendered app whose
 * login is held in a session COOKIE; matched by NAME only (value never read out).
 */
const EESTEKHDAM_SESSION_COOKIE_NAMES = [
  "e-estekhdam_session",
  "estekhdam_session",
  "laravel_session",
  "remember_web",
  "PHPSESSID",
  "XSRF-TOKEN",
];

/**
 * JobVision (SPA) localStorage key candidates that hold the auth JWT. The content
 * script reports the SET OF KEYS present (not values); presence ⇒ logged in.
 */
const JOBVISION_TOKEN_KEYS = ["token", "access_token", "auth_token", "jv_token", "userToken"];

/**
 * IranTalent (SPA) localStorage key candidates that hold the auth token. As with
 * JobVision, a content script reports only WHICH KEYS exist — never the value.
 */
const IRANTALENT_TOKEN_KEYS = [
  "token",
  "access_token",
  "auth_token",
  "id_token",
  "userToken",
  "it_token",
];

/** A cookie as seen by chrome.cookies — we only ever look at `.name`/length here. */
export interface CookieLike {
  name: string;
  /** Present so callers can pass real cookies; this module never forwards it. */
  value?: string;
}

/**
 * Decide whether a Jobinja session cookie is present. Matches by NAME against
 * known session-cookie names; requires a non-empty value to count (an empty
 * cookie is a logged-out remnant) — but the value itself is never returned.
 */
export function jobinjaLoggedIn(cookies: CookieLike[]): boolean {
  return cookies.some(
    (c) =>
      JOBINJA_SESSION_COOKIE_NAMES.some((name) => c.name.toLowerCase().startsWith(name.toLowerCase())) &&
      (c.value === undefined || c.value.length > 0),
  );
}

/**
 * Decide whether JobVision auth token keys are present in the reported key set.
 * Input is the LIST OF localStorage KEY NAMES the content script found — never
 * the token values.
 */
export function jobvisionLoggedIn(localStorageKeys: string[]): boolean {
  const lower = localStorageKeys.map((k) => k.toLowerCase());
  return JOBVISION_TOKEN_KEYS.some((k) => lower.includes(k.toLowerCase()));
}

/** e-estekhdam login = a known session COOKIE name present (value never read out). */
export function eEstekhdamLoggedIn(cookies: CookieLike[]): boolean {
  return cookies.some(
    (c) =>
      EESTEKHDAM_SESSION_COOKIE_NAMES.some((name) =>
        c.name.toLowerCase().startsWith(name.toLowerCase()),
      ) &&
      (c.value === undefined || c.value.length > 0),
  );
}

/** IranTalent login = a known auth-token KEY NAME present in localStorage (value never read). */
export function irantalentLoggedIn(localStorageKeys: string[]): boolean {
  const lower = localStorageKeys.map((k) => k.toLowerCase());
  return IRANTALENT_TOKEN_KEYS.some((k) => lower.includes(k.toLowerCase()));
}

/** Cookie names the background worker should request from chrome.cookies for a board. */
export function sessionCookieNames(board: BoardId): string[] {
  if (board === "jobinja") return [...JOBINJA_SESSION_COOKIE_NAMES];
  if (board === "e-estekhdam") return [...EESTEKHDAM_SESSION_COOKIE_NAMES];
  return [];
}

/** localStorage key candidates a content script should probe for (presence only). */
export function sessionTokenKeys(board: BoardId): string[] {
  if (board === "jobvision") return [...JOBVISION_TOKEN_KEYS];
  if (board === "irantalent") return [...IRANTALENT_TOKEN_KEYS];
  return [];
}

/** Whether a board's login lives in a cookie (server-rendered) or a localStorage token (SPA). */
export function sessionShapeOf(board: BoardId): "cookie" | "token" {
  return board === "jobinja" || board === "e-estekhdam" ? "cookie" : "token";
}
