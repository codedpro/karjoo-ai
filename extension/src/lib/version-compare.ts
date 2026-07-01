/**
 * version-compare — a tiny, dependency-free semver-ish comparator used by the
 * extension's "update available" check (BUG 5 / Track A).
 *
 * We compare the extension's own `chrome.runtime.getManifest().version` against
 * the version the control plane reports at GET /api/extension/version. Chrome
 * extension versions are dot-separated integers ("0.2.0", up to four parts);
 * this comparator handles exactly that shape and fails CLOSED (treats anything
 * it can't parse as "not newer") so a malformed/hostile server response can
 * never trick the popup into nagging about a fake update.
 *
 * This is a PURE function with no chrome / network dependency, so it is unit
 * tested directly.
 */

/**
 * Parse a Chrome-extension-style dot version ("1", "1.2", "0.2.0", "1.2.3.4")
 * into an array of non-negative integers. Returns `null` for anything that is
 * not a well-formed 1–4 part integer version (leading/trailing dots, non-digits,
 * negative, empty). Fail-closed: callers treat `null` as "unknown / not newer".
 */
export function parseVersion(input: string): number[] | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(".");
  // Chrome manifest versions are 1 to 4 dot-separated integers.
  if (parts.length < 1 || parts.length > 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    // Only plain non-negative integers (no signs, spaces, or leading zeros games
    // beyond what Number tolerates); reject empties and non-digit content.
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    out.push(n);
  }
  return out;
}

/**
 * Compare two dot versions.
 *   returns  < 0  if a <  b
 *   returns  0    if a == b (or either is unparseable → treated as equal/no-op)
 *   returns  > 0  if a >  b
 *
 * Unparseable inputs return 0 (fail-closed: "no difference" → no update prompt).
 * Shorter versions are zero-padded, so "0.2" == "0.2.0".
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0; // fail-closed
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Is `latest` a strictly newer version than `current`? Used to decide whether to
 * show the "نسخه‌ی جدید موجود است" banner. Fail-closed: if either side is
 * unparseable, returns `false` (never nag on a bad/hostile response).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
