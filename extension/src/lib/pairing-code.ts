/**
 * Pairing-code helpers (pure logic).
 *
 * The pairing code is the base64url string the Karjoo dashboard shows after the
 * user has already logged in with Google on the web. The extension PAIRS to
 * that existing account with this one-time code — there is NO second login
 * in the extension (LEGITIMACY RULE 5).
 *
 * The server stores only a hash of the code (see src/lib/auth/pairing.ts); this
 * side just sanitizes user input before sending it.
 */

/** base64url alphabet — what server's `randomBytes(...).toString("base64url")` emits. */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Normalize a pasted pairing code: strip whitespace the user may have copied,
 * including internal spaces/newlines. Returns the cleaned code.
 */
export function normalizePairingCode(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/**
 * Validate the shape of a pairing code (not its authenticity — only the server
 * can verify that). Catches obvious paste mistakes before a wasted round-trip.
 */
export function isValidPairingCodeShape(code: string): boolean {
  const c = normalizePairingCode(code);
  // 20 random bytes → 27 base64url chars; allow a generous range for forward-compat.
  return c.length >= 16 && c.length <= 64 && BASE64URL_RE.test(c);
}
