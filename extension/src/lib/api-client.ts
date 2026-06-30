/**
 * Karjoo control-plane API client (extension side).
 *
 * The ONLY module that talks to the Karjoo server. It attaches the Karjoo
 * extension session token as a Bearer credential — NEVER a third-party board
 * cookie/token. Every method is injectable (fetchImpl) so it can be unit-tested
 * without network access.
 *
 * Endpoints (owned by the control-plane / API agent — server contract is the
 * source of truth; this client adapts the extension's narrow domain types to it):
 *   POST /api/extension/link         { pairingCode }      → { token, kind, userId, expiresAt }
 *   GET  /api/extension/me                                → { user, boards }
 *   POST /api/board-accounts/connect { board, accountLabel? } (.strict) → { account }
 *   POST /api/apply-queue/claim      { limit? }           → { count, items: ClaimedApplyItem[] }
 *   POST /api/apply-queue/:id/result { status, externalRef?, reason? } (.strict, id in PATH) → { application, taskStatus }
 *
 * The server schemas for connect + result are `.strict()`: any extra field (e.g.
 * the ConnectPayload `status`, or the report `id` which lives in the URL) is a
 * 400. This client therefore sends EXACTLY the allowed fields and nothing else.
 */
import type { ConnectPayload, Identity, ApplyQueueItem, ApplyResultReport } from "@ext/lib/types";

/* ── server response shapes (control-plane contract) ───────────────────────── */

/** Raw user object from GET /api/extension/me. */
interface ServerMeUser {
  id: string;
  phone: string;
  fullName: string | null;
  isActive: boolean;
}
interface ServerMeResponse {
  user: ServerMeUser;
  boards: unknown[];
}

/** Raw item from POST /api/apply-queue/claim (src/lib/apply/extension-queue.ts ClaimedApplyItem). */
interface ServerClaimedItem {
  taskId: string;
  matchId: string;
  listingId: string;
  board: ApplyQueueItem["board"];
  coverLetter: string | null;
  matchScore: number | null;
  listing: { title: string; company: string | null; city: string | null; url: string };
}
interface ServerClaimResponse {
  count: number;
  items: ServerClaimedItem[];
}

/** Map the server's claimed item onto the extension's render-ready ApplyQueueItem. */
function toApplyQueueItem(it: ServerClaimedItem): ApplyQueueItem {
  return {
    id: it.taskId,
    board: it.board,
    jobTitle: it.listing.title,
    company: it.listing.company ?? undefined,
    city: it.listing.city ?? undefined,
    jobUrl: it.listing.url,
    coverLetter: it.coverLetter ?? "",
    matchScore: it.matchScore ?? undefined,
  };
}

export type FetchImpl = typeof fetch;

export interface ApiClientOptions {
  origin: string;
  /** Karjoo's own extension session token (Bearer). Optional for /link. */
  token?: string | null;
  fetchImpl?: FetchImpl;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class KarjooApi {
  private readonly origin: string;
  private readonly token: string | null;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: ApiClientOptions) {
    this.origin = opts.origin.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);

    const res = await this.fetchImpl(`${this.origin}${path}`, { ...init, headers });
    const text = await res.text();
    let body: unknown = undefined;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) {
      const msg =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `request failed (${res.status})`;
      throw new ApiError(res.status, msg);
    }
    return body as T;
  }

  /**
   * Redeem the one-time pairing code → Karjoo extension session token.
   * Server contract: body `{ pairingCode }`, response `{ token, kind, userId, expiresAt }`.
   * (No identity is returned here; the worker fetches it via me() right after.)
   */
  async link(code: string): Promise<{ token: string; identity?: Identity }> {
    const res = await this.request<{ token: string }>("/api/extension/link", {
      method: "POST",
      body: JSON.stringify({ pairingCode: code }),
    });
    return { token: res.token };
  }

  /**
   * Current signed-in identity (requires token).
   * Server returns `{ user: { id, phone, fullName, isActive }, boards }`; we map
   * it onto the extension's narrow Identity ({ userId, phone?, displayName? }).
   */
  async me(): Promise<Identity> {
    const res = await this.request<ServerMeResponse>("/api/extension/me", { method: "GET" });
    const user = res.user;
    return {
      userId: user.id,
      phone: user.phone || undefined,
      displayName: user.fullName ?? undefined,
    };
  }

  /**
   * Attest that the user is connected to a board. The metadata-only payload is
   * built by buildConnectPayload() (no-secret invariant). The server's connect
   * schema is `.strict()` and allows ONLY { board, accountLabel? } — so we strip
   * the local `status` field here (it is always 'connected' server-side).
   */
  async connectBoard(payload: ConnectPayload): Promise<{ ok: boolean }> {
    const body: { board: ConnectPayload["board"]; accountLabel?: string } = {
      board: payload.board,
      ...(payload.accountLabel ? { accountLabel: payload.accountLabel } : {}),
    };
    await this.request("/api/board-accounts/connect", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { ok: true };
  }

  /**
   * Claim the user's approved apply queue (their own jobs only, server-enforced).
   * Server returns `{ count, items: ClaimedApplyItem[] }`; we map each item onto
   * the extension's ApplyQueueItem render shape.
   */
  async claimQueue(): Promise<{ items: ApplyQueueItem[] }> {
    const res = await this.request<ServerClaimResponse>("/api/apply-queue/claim", {
      method: "POST",
    });
    return { items: (res.items ?? []).map(toApplyQueueItem) };
  }

  /**
   * Report the outcome of a user-approved (or skipped) application. The task id
   * is in the PATH; the server's result schema is `.strict()` and rejects an `id`
   * in the body — so we send only { status, externalRef?, reason? }.
   */
  async reportResult(report: ApplyResultReport): Promise<{ ok: boolean }> {
    const body: { status: ApplyResultReport["status"]; externalRef?: string; reason?: string } = {
      status: report.status,
      ...(report.externalRef ? { externalRef: report.externalRef } : {}),
      ...(report.reason ? { reason: report.reason } : {}),
    };
    await this.request(`/api/apply-queue/${encodeURIComponent(report.id)}/result`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { ok: true };
  }
}
