/**
 * IranTalent authenticated identity probe (background side).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10 / RULE 1): IranTalent is an SPA whose API lives on a DIFFERENT
 * origin (api.irantalent.com) and authenticates with a bearer header the site
 * builds from its own first-party `auth_token_irantalent_new` cookie. A cookie
 * jar alone therefore cannot answer "is this user signed in?" — the header has
 * to be reconstructed the same way the site does. So, unlike the name-only
 * cookie probes, this module reads that cookie's VALUE.
 *
 * It stays inside the browser: the token is used ONLY against IranTalent's own
 * API, is never logged, never persisted by Karjoo, and never returned to any
 * caller — `probeIranTalentIdentity` hands back a boolean, a non-secret display
 * name, and a bounded reason. This is the user acting as themselves on the site
 * they are already signed into; nothing here evades a bot detector.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ProbeSessionResult } from "@ext/lib/messages";

const SITE_ORIGIN = "https://www.irantalent.com";
const API_ROOT = "https://api.irantalent.com/api/v1";
const AUTH_COOKIE = "auth_token_irantalent_new";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * PURE: turn the site's stored token envelope into the Authorization header its
 * own http service would send. Returns null for anything malformed or expired.
 */
export function authorizationFromEnvelope(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let envelope: Record<string, unknown>;
  try {
    envelope = record(JSON.parse(decodeURIComponent(raw)));
  } catch {
    try {
      envelope = record(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  const tokenType = text(envelope.token_type);
  const accessToken = text(envelope.access_token);
  if (!tokenType || !accessToken) return null;
  const createdAt = Number(envelope.created_at ?? 0);
  const expiresIn = Number(envelope.expires_in ?? 0);
  if (createdAt > 0 && expiresIn > 0 && createdAt + expiresIn * 1000 <= Date.now()) return null;
  return `${tokenType} ${accessToken}`;
}

/** PURE: a non-secret display label from a candidate profile payload. */
export function accountLabelFromProfile(payload: unknown): string | undefined {
  const data = record(record(payload).data ?? payload);
  const user = record(data.user ?? data);
  const name = [text(user.first_name), text(user.surname)].filter(Boolean).join(" ").trim();
  return name || text(user.email) || text(data.email) || undefined;
}

/**
 * Read the live Authorization header from the user's own IranTalent cookie.
 * Background-only (needs the `cookies` permission). Returns null when signed out.
 */
export async function readIranTalentAuthorization(): Promise<string | null> {
  try {
    const cookie = await chrome.cookies.get({ url: SITE_ORIGIN, name: AUTH_COOKIE });
    return authorizationFromEnvelope(cookie?.value ?? null);
  } catch {
    return null;
  }
}

/**
 * Ask IranTalent's own profile endpoint whether this session is really signed in.
 * Returns a boolean + a non-secret label — never the token.
 */
export async function probeIranTalentIdentity(
  fetchImpl: typeof fetch = fetch,
  readAuthorization: () => Promise<string | null> = readIranTalentAuthorization,
): Promise<ProbeSessionResult> {
  const authorization = await readAuthorization();
  if (!authorization) return { loggedIn: false, reason: "logged_out" };
  try {
    const response = await fetchImpl(`${API_ROOT}/candidate/profile`, {
      headers: { accept: "application/json", authorization },
    });
    if (response.status === 401 || response.status === 403) {
      return { loggedIn: false, reason: "logged_out" };
    }
    if (response.status === 429) return { loggedIn: false, reason: "security_challenge" };
    if (!response.ok) return { loggedIn: false, reason: "probe_unavailable" };
    const payload = await response.json();
    const label = accountLabelFromProfile(payload);
    return label ? { loggedIn: true, accountLabelHint: label } : { loggedIn: true };
  } catch {
    return { loggedIn: false, reason: "probe_unavailable" };
  }
}
