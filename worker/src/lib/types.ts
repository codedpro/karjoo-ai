/**
 * Shared worker-fleet domain types — the wire contracts between this node and the
 * Karjoo control plane (Track A routes under /api/fleet/*).
 *
 * These MIRROR the server's source-of-truth shapes so the node consumes exactly
 * what the control plane returns:
 *   • FleetJob  ← src/lib/fleet/dispatch.ts (the per-job payload, incl. the
 *                 server-side-DECRYPTED session — the ONE thing that leaves the vault).
 *   • SessionBundle ← the extension's session-snapshot.ts / the server's
 *                 sessionBundleSchema (cookies + storage maps + the user's own UA).
 *
 * §10 FIRM LINE: the session is the user's OWN, captured faithfully, used only for
 * that same user. No fingerprint spoofing, no rotation — acting as the authorized
 * user, not evasion. The session is in-memory only and NEVER logged/persisted here.
 */

/** The job-board ids the fleet can apply on — same string values as the control plane. */
export type BoardId = "jobinja" | "jobvision" | "e-estekhdam" | "irantalent";

/**
 * One claimed apply job, returned by POST /api/fleet/claim. Mirrors
 * `FleetJob` (src/lib/fleet/dispatch.ts). `session` is the server-side DECRYPTED
 * session of the SAME user this job is for — used in-memory and discarded after.
 */
export interface FleetJob {
  taskId: string;
  /** The user this job runs for (and whose session it uses). Echoed back on report. */
  userId: string;
  board: string;
  /** The job listing page the node navigates to and fills/submits. */
  listingUrl: string;
  /** The drafted cover letter to pre-fill (when the board has a field). */
  coverLetter: string | null;
  /**
   * HTML of the per-job custom résumé (when generated). The node renders it to a PDF
   * with Playwright and uploads it via the form's "upload résumé" path — jobinja's
   * cover-letter replacement. NEVER logged.
   */
  resumeHtml: string | null;
  /** Upload filename the employer sees — "Full Name_Company.pdf". Never the tool's name. */
  resumeFileName?: string | null;
  /**
   * The user's OWN decrypted session (serialized SessionBundle JSON, or a raw
   * bundle object). The node parses it, injects it, uses it in-memory, and
   * DISCARDS it. NEVER logged, never written to disk.
   */
  session: string;
}

/** A single captured cookie (matches the server `sessionBundleSchema` cookie shape). */
export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix SECONDS, if the cookie is non-session. */
  expirationDate?: number;
}

/**
 * The decrypted session bundle the vault stored for this (user, board). Matches the
 * extension/server `SessionBundle`: cookies + localStorage/sessionStorage maps + the
 * user's own UA (for header parity on replay — NOT spoofing).
 */
export interface SessionBundle {
  cookies?: SessionCookie[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  /** The user's OWN browser UA. Replayed faithfully (header parity, not evasion). */
  userAgent?: string;
  /** ISO capture timestamp (observability only). */
  capturedAt?: string;
}

/** The terminal outcome the node reports for a job (mirrors the server enum). */
export type ApplyStatus = "submitted" | "skipped" | "failed" | "blocked";

/**
 * The result payload POSTed to /api/fleet/result. Carries NO secret material — the
 * `proof` is a non-secret descriptor (final URL, confirmation flag, screenshot ref),
 * NEVER a cookie/token/session value.
 */
export interface FleetResultReport {
  taskId: string;
  userId: string;
  status: ApplyStatus;
  externalRef?: string;
  reason?: string;
  proof?: Record<string, unknown>;
}

/** A server-issued command (mirrors worker_commands rows). */
export interface WorkerCommand {
  id: string;
  command: "update" | "restart";
  payload: Record<string, unknown> | null;
}

/** The credential issued ONCE at enrollment, persisted locally and replayed as Bearer. */
export interface NodeCredentialRecord {
  /** The opaque per-node credential (only its HMAC hash is stored server-side). */
  credential: string;
  /** The server's node id (for reference/observability only — never trusted as auth). */
  nodeId: string;
  /** The stable node key this credential was issued for (matches our config). */
  nodeKey: string;
  /** ISO timestamp of enrollment. */
  enrolledAt: string;
}
