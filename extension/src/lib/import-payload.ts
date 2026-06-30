/**
 * The DATA-ONLY "import my profile" payload builder.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1 (docs/ARCHITECTURE.md §10) — THE WHOLE POINT OF THIS MODULE:
 *
 *   The extension imports the user's OWN profile data from boards they are
 *   logged into. It sends profile DATA only — NEVER a raw cookie / token /
 *   password / session / authorization header / any credential.
 *
 *   This module is the single chokepoint that builds the body POSTed to
 *   POST /api/profile/import. Before returning, it RECURSIVELY scans the payload
 *   and throws if ANY key looks like secret material — so the "no credential
 *   leaves the browser" invariant is PROVABLE (aggressively unit-tested), not
 *   merely promised. It mirrors the server-side `assertNoCredentials`
 *   (src/lib/apply/import.ts) so both ends of the wire fail closed.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BoardId } from "@ext/lib/config";
import type { ScrapedProfile } from "@ext/lib/import-types";

/**
 * Substrings that, if present in ANY key name (at any depth), indicate the value
 * could be secret material. Case-insensitive, substring match. Deliberately
 * strict: it is better to drop a harmless import than to leak a credential.
 *
 * Kept in lock-step with the server's FORBIDDEN_KEY_SUBSTRINGS
 * (src/lib/apply/import.ts) so the extension never builds something the server
 * would (rightly) reject.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "cookie",
  "set-cookie",
  "password",
  "passwd",
  "secret",
  "token", // accessToken / refreshToken / jwt-as-token / csrfToken
  "jwt",
  "bearer",
  "authorization",
  "auth_header",
  "authheader",
  "credential",
  "session", // sessionId / sessionBlob / localStorage-session
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "csrf",
  "xsrf",
  "otp",
] as const;

/** The only top-level keys allowed in the outgoing import body. */
const ALLOWED_TOP_LEVEL_KEYS = new Set(["board", "payload"]);

export class SecretLeakError extends Error {
  /** The offending key path that tripped the guard. */
  readonly field: string;
  constructor(field: string) {
    super(
      `refusing to send import payload: key "${field}" looks like secret ` +
        `material (LEGITIMACY RULE 1 — imports carry profile DATA only, never a ` +
        `cookie/token/password/session)`,
    );
    this.name = "SecretLeakError";
    this.field = field;
  }
}

/** Is this key name credential-shaped? (case-insensitive, substring). */
function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((bad) => lower.includes(bad));
}

/**
 * Recursively walk an arbitrary value (objects/arrays) and throw SecretLeakError
 * the moment any object key looks credential-shaped. Depth-capped so a malformed
 * (deeply nested) value cannot DoS the guard. This is the fail-closed core.
 */
export function assertNoSecrets(value: unknown, path = "", depth = 0): void {
  if (depth > 12) {
    throw new SecretLeakError(`${path || "(root)"} (nesting too deep)`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecrets(item, `${path}[${i}]`, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isForbiddenKey(key)) throw new SecretLeakError(childPath);
      assertNoSecrets(child, childPath, depth + 1);
    }
  }
}

/** The exact, DATA-only body POSTed to /api/profile/import. */
export interface ImportPayloadBody {
  board: BoardId;
  /** Profile DATA only — scanned to PROVE it carries no credential. */
  payload: ScrapedProfile;
}

/**
 * Build the import body for one board. Steps:
 *   1. Deep-clone the scraped profile through JSON so only plain serializable
 *      DATA survives (functions/DOM nodes/getters are dropped — they cannot ride
 *      along by accident).
 *   2. Drop any top-level scraped field that is empty/undefined.
 *   3. Run `assertNoSecrets` over the WHOLE body — throws if anything looks like
 *      a credential. This is the proof, not a promise.
 *
 * @throws {SecretLeakError} if any credential-shaped key is present at any depth.
 */
export function buildImportPayload(board: BoardId, profile: ScrapedProfile): ImportPayloadBody {
  // JSON round-trip = a structural firewall: only plain DATA can pass; any
  // accidental DOM node, function, cookie-bearing object, etc. is stripped to a
  // plain value (and then still scanned below).
  const cloned = JSON.parse(JSON.stringify(profile ?? {})) as Record<string, unknown>;

  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cloned)) {
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && val.trim() === "") continue;
    if (Array.isArray(val) && val.length === 0) continue;
    cleaned[key] = val;
  }

  const body: ImportPayloadBody = { board, payload: cleaned as ScrapedProfile };

  // Guard the WHOLE body (board + payload, recursively). Any credential-shaped
  // key anywhere → throw before it can leave the browser.
  assertNoSecrets(body);

  // Belt-and-suspenders: only board + payload may appear at the top level.
  for (const key of Object.keys(body)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) throw new SecretLeakError(key);
  }

  return body;
}
