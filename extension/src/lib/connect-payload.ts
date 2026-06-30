/**
 * The metadata-only "connect board account" payload builder.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1 (docs/ARCHITECTURE.md §10) — THE WHOLE POINT OF THIS BUILD:
 *
 *   The extension may read the user's OWN job-board session ONLY locally, in the
 *   user's browser, for user-present, user-approved actions. It MUST NEVER
 *   transmit raw third-party cookies / tokens / passwords to the Karjoo server.
 *   The connect-account endpoint stores ONLY metadata: { board, status, label }.
 *
 * This module is the single chokepoint that builds the body sent to
 * POST /api/board-accounts/connect. It is deliberately tiny and aggressively
 * tested so the "no secret material leaves the browser" invariant is provable,
 * not just promised.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BoardId } from "@ext/lib/config";
import type { ConnectPayload } from "@ext/lib/types";

/**
 * Substrings that, if present in a key name, indicate the value would be secret
 * material. We refuse to emit any payload containing such a key. This is a
 * belt-and-suspenders runtime guard on top of the TS type `ConnectPayload`.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "cookie",
  "token",
  "password",
  "passwd",
  "secret",
  "credential",
  "session",
  "jwt",
  "auth",
  "bearer",
  "csrf",
  "apikey",
  "api_key",
];

/** The only keys allowed in the outgoing connect body. */
const ALLOWED_KEYS = new Set(["board", "status", "accountLabel"]);

export class SecretLeakError extends Error {
  constructor(key: string) {
    super(
      `refusing to send connect payload: key "${key}" looks like secret material ` +
        `(LEGITIMACY RULE 1 — only board/status/label may leave the browser)`,
    );
    this.name = "SecretLeakError";
  }
}

export interface BuildConnectInput {
  board: BoardId;
  /** Optional, user-facing, non-secret label. Trimmed; empty → omitted. */
  accountLabel?: string;
}

/**
 * Build the connect payload. Always sets status:'connected' (the endpoint stores
 * only that the user attests they are connected — the boolean, not the secret).
 *
 * Throws SecretLeakError if anything secret-shaped is detected — a fail-closed
 * guard so a future refactor cannot silently exfiltrate a credential.
 */
export function buildConnectPayload(input: BuildConnectInput): ConnectPayload {
  const label = input.accountLabel?.trim();

  const payload: ConnectPayload = {
    board: input.board,
    status: "connected",
    ...(label ? { accountLabel: label } : {}),
  };

  assertNoSecrets(payload as unknown as Record<string, unknown>);
  return payload;
}

/**
 * Throws if `obj` contains any key that is not in the allow-list, or any key
 * whose name matches a forbidden (secret-shaped) substring. Recurses one level
 * defensively in case a nested object is ever introduced by mistake.
 */
export function assertNoSecrets(obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEY_SUBSTRINGS.some((bad) => lower.includes(bad))) {
      throw new SecretLeakError(key);
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw new SecretLeakError(key);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assertNoSecrets(value as Record<string, unknown>);
    }
  }
}
