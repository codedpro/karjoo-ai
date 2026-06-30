/**
 * The apply-result payload chokepoint (auto-apply path).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1 / §10 — PROVABLE, not promised:
 *
 *   When background auto-apply reports an outcome to
 *   POST /api/apply-queue/:id/result, the body MUST carry ONLY non-secret result
 *   metadata: { id, status, externalRef?, reason? }. It MUST NEVER carry the
 *   user's board cookie / token / session blob / password / any credential, and
 *   never the cover-letter body or other large free text (the server already has
 *   the draft; the result is just an outcome).
 *
 *   This module is the single chokepoint that builds the result-report object.
 *   It recursively scans for credential-shaped keys and throws SecretLeakError if
 *   any is present, so "the result payload contains no secrets" is unit-testable.
 *   It mirrors connect-payload.ts / import-payload.ts (same fail-closed posture).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ApplyResultReport } from "@ext/lib/types";

/** Key-name substrings that indicate secret material (case-insensitive). */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "cookie",
  "set-cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "jwt",
  "bearer",
  "authorization",
  "auth_header",
  "authheader",
  "credential",
  "session",
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "csrf",
  "xsrf",
  "otp",
] as const;

/** The ONLY keys allowed in the outgoing result report. */
const ALLOWED_KEYS = new Set(["id", "status", "externalRef", "reason"]);

export class SecretLeakError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(
      `refusing to send apply result: key "${field}" looks like secret material ` +
        `(LEGITIMACY RULE 1 — the result report carries only id/status/externalRef/reason)`,
    );
    this.name = "SecretLeakError";
    this.field = field;
  }
}

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((bad) => lower.includes(bad));
}

/**
 * Recursively scan a value; throw the moment any object key is credential-shaped.
 * Depth-capped so a malformed nested value cannot DoS the guard.
 */
export function assertNoSecrets(value: unknown, path = "", depth = 0): void {
  if (depth > 12) throw new SecretLeakError(`${path || "(root)"} (nesting too deep)`);
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

/** Input to build an auto-apply result report (already non-secret by shape). */
export interface BuildApplyResultInput {
  /** The apply task/application id (lives in the URL path server-side too). */
  id: string;
  status: ApplyResultReport["status"];
  /** Optional board-returned reference (e.g. a confirmation id). Non-secret. */
  externalRef?: string;
  /** Optional short, non-secret reason (e.g. "below threshold", "selector not found"). */
  reason?: string;
}

/**
 * Build the auto-apply result report, then PROVE it carries no secret. Steps:
 *   1. JSON round-trip = structural firewall (functions/DOM/getters dropped).
 *   2. Keep only the allowed, non-empty fields.
 *   3. assertNoSecrets over the WHOLE object → throws on any credential-shaped key.
 *   4. Allow-list the top-level keys (belt-and-suspenders).
 *
 * @throws {SecretLeakError} if any credential-shaped key sneaks in.
 */
export function buildApplyResultReport(input: BuildApplyResultInput): ApplyResultReport {
  const cloned = JSON.parse(
    JSON.stringify({
      id: input.id,
      status: input.status,
      ...(input.externalRef ? { externalRef: input.externalRef } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    }),
  ) as Record<string, unknown>;

  const report: ApplyResultReport = {
    id: String(cloned.id ?? ""),
    status: cloned.status as ApplyResultReport["status"],
    ...(typeof cloned.externalRef === "string" && cloned.externalRef.trim()
      ? { externalRef: cloned.externalRef.trim() }
      : {}),
    ...(typeof cloned.reason === "string" && cloned.reason.trim()
      ? { reason: cloned.reason.trim().slice(0, 280) }
      : {}),
  };

  if (!report.id) throw new SecretLeakError("(missing id)");

  assertNoSecrets(report);
  for (const key of Object.keys(report)) {
    if (!ALLOWED_KEYS.has(key)) throw new SecretLeakError(key);
  }
  return report;
}
