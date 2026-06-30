/**
 * Local session snapshot model + vault-refresh payload builder.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — LOCAL session refresh (Free/Pro) and vault push (Max/Max+):
 *
 *   The extension periodically RECAPTURES the user's CURRENT session for the
 *   boards they connected — cookies (via chrome.cookies) and localStorage /
 *   sessionStorage (via a content-script probe) — and keeps a FRESH LOCAL copy so
 *   background apply keeps working as the board rotates the session. For Free/Pro
 *   this snapshot NEVER leaves the device.
 *
 *   For premium (Max/Max+) the SAME snapshot is ALSO pushed to the user's OWN
 *   encrypted server vault via POST /api/session/refresh — the ONE endpoint that
 *   is allowed to receive the session, and only ever the user's own session for
 *   the user's own auto-apply (the server stores it AES-256-GCM encrypted). This
 *   is the ONLY place raw session material is transmitted, and only to that
 *   endpoint. The apply-RESULT payload, by contrast, must carry NO secret
 *   (see apply-result-payload.ts).
 *
 *   THE FIRM LINE: this is the user's own session, captured faithfully, used only
 *   for that same user. No fingerprint spoofing, no rotation — not evasion.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This module is PURE (no chrome.*). The background worker captures the raw
 * cookies/storage and hands them here to be shaped; the API client posts the
 * resulting blob to /api/session/refresh.
 */
import type { BoardId } from "@ext/lib/config";

/** A single captured cookie (name + value) for a board's session. */
export interface CapturedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix seconds, if the cookie is non-session. */
  expirationDate?: number;
}

/** localStorage / sessionStorage key→value pairs captured by the content probe. */
export interface CapturedStorage {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
}

/**
 * The raw, LOCAL session snapshot for one board. This is the device-only copy
 * that the apply flow replays; for premium it is also the source of the vault
 * push. It DOES contain secret material — that is the point — so it must NEVER be
 * logged, and only ever be sent to /api/session/refresh (the user's own vault).
 */
export interface SessionSnapshot {
  board: BoardId;
  /** "cookie" boards carry cookies; "token" SPA boards carry storage tokens. */
  shape: "cookie" | "token";
  cookies?: CapturedCookie[];
  storage?: CapturedStorage;
  /** When this snapshot was captured (ms epoch). */
  capturedAt: number;
}

/** A short, NON-secret descriptor of a snapshot — safe to log / show in the UI. */
export interface SessionShapeDescriptor {
  board: BoardId;
  shape: "cookie" | "token";
  cookieNames: string[];
  storageKeys: string[];
  capturedAt: number;
}

/**
 * Derive a non-secret descriptor from a snapshot: NAMES/KEYS only, never values.
 * Used for the vault push metadata (`sessionShape`) and for any UI/logging — so
 * we can describe "what we captured" without ever exposing a value.
 */
export function describeSnapshot(snap: SessionSnapshot): SessionShapeDescriptor {
  const cookieNames = (snap.cookies ?? []).map((c) => c.name).sort();
  const storageKeys = [
    ...Object.keys(snap.storage?.localStorage ?? {}),
    ...Object.keys(snap.storage?.sessionStorage ?? {}),
  ].sort();
  return {
    board: snap.board,
    shape: snap.shape,
    cookieNames,
    storageKeys,
    capturedAt: snap.capturedAt,
  };
}

/** True when a snapshot actually carries something replayable (else skip the push). */
export function snapshotHasMaterial(snap: SessionSnapshot): boolean {
  const cookieCount = snap.cookies?.length ?? 0;
  const lsCount = Object.keys(snap.storage?.localStorage ?? {}).length;
  const ssCount = Object.keys(snap.storage?.sessionStorage ?? {}).length;
  return cookieCount + lsCount + ssCount > 0;
}

/**
 * The captured session BUNDLE — matches the control-plane `sessionBundleSchema`
 * (src/lib/api/session-schemas.ts) EXACTLY: cookies + storage maps + optional UA
 * and capture time. The server `.strict()`-validates this, encrypts it whole
 * (AES-256-GCM), and stores only the ciphertext.
 */
export interface SessionBundle {
  cookies?: CapturedCookie[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  /** The user's OWN browser UA (for header parity on replay). Not spoofing. */
  userAgent?: string;
  /** ISO capture timestamp (server uses it for observability only). */
  capturedAt?: string;
}

/**
 * The body POSTed to POST /api/session/refresh (premium only), matching the
 * server's `sessionRefreshBodySchema` (`.strict()`): { board, session, expiresAt? }.
 *
 * NOTE: unlike the connect/import/result chokepoints, this body INTENTIONALLY
 * carries the session — it is the only sanctioned transmission, and only to the
 * vault endpoint. The server stores it encrypted; it is never returned in plain.
 */
export interface SessionRefreshBody {
  board: BoardId;
  /** The user's OWN captured session bundle (the server encrypts it at rest). */
  session: SessionBundle;
  /** Optional ISO expiry; absent → the server applies a conservative TTL. */
  expiresAt?: string;
}

/**
 * Build the vault-refresh body from a local snapshot, in the EXACT shape the
 * server expects. Returns null when the snapshot has no material (nothing worth
 * pushing). The server is `.strict()`, so we emit only the allowed keys.
 */
export function buildSessionRefreshBody(
  snap: SessionSnapshot,
  userAgent?: string,
): SessionRefreshBody | null {
  if (!snapshotHasMaterial(snap)) return null;
  const session: SessionBundle = {
    ...(snap.cookies && snap.cookies.length > 0 ? { cookies: snap.cookies } : {}),
    ...(snap.storage?.localStorage && Object.keys(snap.storage.localStorage).length > 0
      ? { localStorage: snap.storage.localStorage }
      : {}),
    ...(snap.storage?.sessionStorage && Object.keys(snap.storage.sessionStorage).length > 0
      ? { sessionStorage: snap.storage.sessionStorage }
      : {}),
    ...(userAgent ? { userAgent } : {}),
    capturedAt: new Date(snap.capturedAt).toISOString(),
  };
  return { board: snap.board, session };
}

/**
 * Serialize a snapshot to a deterministic string (used only for the LOCAL cache /
 * tests). The server has its own serializer; this is not what crosses the wire.
 */
export function serializeSnapshot(snap: SessionSnapshot): string {
  return JSON.stringify({
    board: snap.board,
    shape: snap.shape,
    cookies: snap.cookies ?? [],
    storage: snap.storage ?? {},
    capturedAt: snap.capturedAt,
  });
}
