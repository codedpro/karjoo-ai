/**
 * Session injection — turn the user's decrypted SessionBundle into the inputs a
 * Playwright context needs to act as that user.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10: this replays the user's OWN session FAITHFULLY — their real cookies, their
 * real localStorage/sessionStorage tokens, and their real UA. That is acting as
 * the authorized user, NOT evasion. We do NOT fabricate or rotate fingerprints.
 *
 * The bundle is parsed, used to build (a) cookies for context.addCookies, (b) an
 * init script that restores localStorage/sessionStorage before the page's own JS
 * runs, and (c) the user's UA for the context. It is held in memory for ONE job
 * and discarded; it is NEVER logged (this module never calls the logger) and NEVER
 * written to disk.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SessionBundle, SessionCookie } from "./types.js";

/** A Playwright-shaped cookie (what context.addCookies expects). */
export interface PlaywrightCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix SECONDS. */
  expires?: number;
}

/** The fully-prepared inputs for one job's browser context. */
export interface PreparedSession {
  cookies: PlaywrightCookie[];
  /** A script run BEFORE page scripts: restores localStorage/sessionStorage. */
  initScript: string | null;
  /** The user's OWN UA (header parity on replay — not spoofing). */
  userAgent: string | null;
}

/**
 * Parse the job's `session` field into a SessionBundle. The control plane sends it
 * as the serialized vault JSON; we accept either a JSON string or an already-parsed
 * object. Throws on anything unparseable so the runner records a clean failure.
 */
export function parseSessionBundle(session: string | object): SessionBundle {
  let raw: unknown;
  if (typeof session === "string") {
    raw = JSON.parse(session);
  } else {
    raw = session;
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("session bundle is not an object");
  }
  // The vault may wrap the bundle (e.g. { session: {...} } or { bundle: {...} }).
  const obj = raw as Record<string, unknown>;
  const inner =
    obj.cookies || obj.localStorage || obj.sessionStorage || obj.userAgent
      ? obj
      : (obj.session as Record<string, unknown>) ??
        (obj.bundle as Record<string, unknown>) ??
        obj;
  return inner as SessionBundle;
}

/** Map a captured cookie to the Playwright cookie shape, deriving a URL when needed. */
function toPlaywrightCookie(c: SessionCookie, fallbackUrl: string): PlaywrightCookie {
  const out: PlaywrightCookie = { name: c.name, value: c.value };
  if (c.domain) {
    out.domain = c.domain;
    out.path = c.path ?? "/";
  } else {
    // No domain → bind the cookie to the listing's origin via `url`.
    out.url = fallbackUrl;
  }
  if (c.secure !== undefined) out.secure = c.secure;
  if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
  if (typeof c.expirationDate === "number") out.expires = c.expirationDate;
  return out;
}

/**
 * Build the init script that restores localStorage/sessionStorage for the board's
 * origin BEFORE the page's own scripts run. Returns null when there is nothing to
 * restore. The values are embedded as a JSON literal the page applies to
 * window.localStorage/sessionStorage.
 *
 * NOTE: addInitScript runs in EVERY frame; we guard on origin so we only restore
 * storage on the board's own origin (the user's real session scope).
 */
export function buildStorageInitScript(bundle: SessionBundle, originUrl: string): string | null {
  const ls = bundle.localStorage ?? {};
  const ss = bundle.sessionStorage ?? {};
  if (Object.keys(ls).length === 0 && Object.keys(ss).length === 0) return null;

  let origin: string;
  try {
    origin = new URL(originUrl).origin;
  } catch {
    origin = originUrl;
  }

  const payload = JSON.stringify({ origin, localStorage: ls, sessionStorage: ss });
  // The init script restores storage only when running on the board's origin.
  return `(() => {
  try {
    const data = ${payload};
    if (window.location.origin !== data.origin) return;
    for (const [k, v] of Object.entries(data.localStorage)) {
      try { window.localStorage.setItem(k, v); } catch {}
    }
    for (const [k, v] of Object.entries(data.sessionStorage)) {
      try { window.sessionStorage.setItem(k, v); } catch {}
    }
  } catch {}
})();`;
}

/**
 * Prepare everything one job's context needs from the bundle: cookies, the storage
 * init script, and the UA. Pure and synchronous — no browser, no logging.
 */
export function prepareSession(bundle: SessionBundle, listingUrl: string): PreparedSession {
  const cookies = (bundle.cookies ?? []).map((c) => toPlaywrightCookie(c, listingUrl));
  const initScript = buildStorageInitScript(bundle, listingUrl);
  return {
    cookies,
    initScript,
    userAgent: bundle.userAgent ?? null,
  };
}
