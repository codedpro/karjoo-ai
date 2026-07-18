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
 *   POST /api/profile/import         { board, payload }    → { import, appliedFields? }
 *
 * The server schemas for connect + result are `.strict()`: any extra field (e.g.
 * the ConnectPayload `status`, or the report `id` which lives in the URL) is a
 * 400. This client therefore sends EXACTLY the allowed fields and nothing else.
 *
 * For profile import the body is the DATA-ONLY object built by buildImportPayload
 * (import-payload.ts), which PROVES no credential rides along. The server applies
 * the SAME no-credentials guard and binds the userId to the session — never the
 * payload (docs §10).
 */
import type {
  ConnectPayload,
  Identity,
  ApplyQueueItem,
  ApplyResultReport,
  AutoApplySettings,
  PlanTier,
} from "@ext/lib/types";
import type { ImportPayloadBody } from "@ext/lib/import-payload";
import type { SessionRefreshBody } from "@ext/lib/session-snapshot";
import { DEFAULT_AUTO_APPLY_MIN_SCORE } from "@ext/lib/api-contracts";

/* ── server response shapes (control-plane contract) ───────────────────────── */

/** Raw user object from GET /api/extension/me (Google identity — no phone). */
interface ServerMeUser {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
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
  /**
   * Present only when the auto-apply gate returned an empty queue: the toggle is
   * OFF ("disabled") or the daily cap is reached ("quota_exceeded"). The runner
   * uses this to stop the tick without treating it as an error.
   */
  reason?: "disabled" | "quota_exceeded";
}

/** Server shape for GET/PUT /api/auto-apply (control-plane contract). */
interface ServerAutoApplySettings {
  enabled?: boolean;
  minScore?: number;
}

/**
 * Response from POST /api/profile/import. The endpoint is owned by the API/import
 * track and returns the FLAT `ApplyImportSummary` shape (src/lib/apply/import-service.ts):
 *   { importId, board, status, appliedFields, addedSkills, importedApplicationCount }
 * We model only the non-secret fields we might surface (everything optional and
 * defensively read so a server-shape tweak does not break the client).
 */
interface ServerImportResponse {
  importId?: string;
  board?: string;
  status?: string;
  /** Field names the server applied to the user's profile (e.g. ["skills","city"]). */
  appliedFields?: string[];
  /** Skills newly unioned into the profile by this import. */
  addedSkills?: string[];
}

/** Build a short, non-secret, Persian-ish summary line from the import response. */
function importSummary(res: ServerImportResponse | undefined): string | undefined {
  const fields = res?.appliedFields;
  if (Array.isArray(fields) && fields.length > 0) {
    return `${fields.length} مورد به‌روزرسانی شد`;
  }
  // status === "received" means nothing new was merged (already up to date).
  if (res?.status) return String(res.status);
  return undefined;
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

  /**
   * Low-level request that NEVER throws on a non-2xx — it returns the status +
   * parsed body so callers can branch on it (e.g. claim's gated `reason`, the
   * result endpoint's 429 daily-cap, or a 404 "route not deployed yet"). The
   * higher-level `request` wraps this and throws on !ok for the simple cases.
   */
  private async requestRaw(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
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
    return { ok: res.ok, status: res.status, body };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { ok, status, body } = await this.requestRaw(path, init);
    if (!ok) {
      const msg =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `request failed (${status})`;
      throw new ApiError(status, msg);
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
   * Server returns `{ user: { id, email, name, avatarUrl, fullName, isActive }, boards }`;
   * we map it onto the extension's narrow Identity ({ userId, email?, displayName? }).
   * displayName prefers the Google profile name, falling back to the stored fullName.
   */
  async me(): Promise<Identity> {
    const res = await this.request<ServerMeResponse>("/api/extension/me", { method: "GET" });
    const user = res.user;
    return {
      userId: user.id,
      email: user.email ?? undefined,
      displayName: user.name ?? user.fullName ?? undefined,
    };
  }

  /**
   * Raw /api/extension/me response, including the connected `boards` metadata
   * (the background auto-apply tick needs to know which boards are connected).
   * The boards array is metadata only — never a session/credential.
   */
  async meRaw(): Promise<{ user: ServerMeUser; boards: { board: string; status?: string }[] }> {
    const res = await this.request<ServerMeResponse>("/api/extension/me", { method: "GET" });
    return {
      user: res.user,
      boards: (res.boards as { board: string; status?: string }[]) ?? [],
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
  async claimQueue(limit?: number): Promise<{ items: ApplyQueueItem[]; reason?: "disabled" | "quota_exceeded" }> {
    const res = await this.request<ServerClaimResponse>("/api/apply-queue/claim", {
      method: "POST",
      ...(typeof limit === "number" ? { body: JSON.stringify({ limit }) } : {}),
    });
    return {
      items: (res.items ?? []).map(toApplyQueueItem),
      ...(res.reason ? { reason: res.reason } : {}),
    };
  }

  /**
   * Populate the apply queue on demand from the user's saved FILTER selections
   * (the pivot's default, NON-AI flow). Contract: POST /api/apply/find-jobs
   * (extension bearer, session-bound server-side) → { queued: number } (the count
   * of newly-enqueued listings; older/other server shapes may say `count`).
   *
   * The server scrapes the user's filtered Jobinja search and enqueues EVERY
   * matching listing; AI scoring is applied server-side ONLY when the user enabled
   * the premium AI filter AND is entitled — the extension never decides that.
   *
   * Resilient: a 404 means the control plane predates this route (older deploy) —
   * we surface a clear "update needed" message instead of a generic failure. A 401
   * still throws ApiError(401) so the worker drops back to the pairing view.
   */
  async findJobs(): Promise<{ queued: number }> {
    const { ok, status, body } = await this.requestRaw("/api/apply/find-jobs", {
      method: "POST",
    });
    if (!ok) {
      if (status === 404) {
        throw new ApiError(
          404,
          "این نسخه‌ی سرورِ کارجو هنوز «پیدا کردن شغل‌ها» را ندارد. کمی بعد دوباره تلاش کنید.",
        );
      }
      throw new ApiError(status, errorOf(body, status));
    }
    // پذیرشِ هر دو شکلِ { queued } (قرارداد) و { count } (اگر سرور این‌طور برگرداند).
    const b = (body ?? {}) as { queued?: unknown; count?: unknown };
    const queued =
      typeof b.queued === "number" ? b.queued : typeof b.count === "number" ? b.count : 0;
    return { queued };
  }

  /**
   * Import the user's OWN profile DATA from one board into their Karjoo profile.
   *
   * The body MUST come from buildImportPayload() (the DATA-only chokepoint) — it
   * is { board, payload } with no credential-shaped key. We POST it verbatim; the
   * server normalizes per board, binds it to THIS session's user (never a userId
   * from the body), and stores an import record. Returns a short, non-secret
   * summary string for the UI when the server provides one.
   */
  async importProfile(body: ImportPayloadBody): Promise<{ ok: boolean; summary?: string }> {
    const res = await this.request<ServerImportResponse>("/api/profile/import", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { ok: true, summary: importSummary(res) };
  }

  /**
   * داده‌ی *پارس‌شده‌ی* جابینجا (تحلیلِ درخواست‌ها/پروفایل/cvId) را push می‌کند. هرگز کوکی/توکن؛
   * فقط داده. سرور کلیدهای شبیهِ اعتبارنامه را هم رد می‌کند (§10).
   */
  async pushJobinja(body: {
    applications?: unknown[];
    profile?: Record<string, unknown>;
  }): Promise<{ ok: boolean; applications?: number; profile?: boolean }> {
    return this.request<{ ok: boolean; applications?: number; profile?: boolean }>(
      "/api/boards/jobinja/push",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  /**
   * Report the outcome of a user-approved (or skipped) application. The task id
   * is in the PATH; the server's result schema is `.strict()` and rejects an `id`
   * in the body — so we send only { status, externalRef?, reason? }.
   */
  async reportResult(report: ApplyResultReport): Promise<{ ok: boolean; status: number }> {
    const body: { status: ApplyResultReport["status"]; externalRef?: string; reason?: string } = {
      status: report.status,
      ...(report.externalRef ? { externalRef: report.externalRef } : {}),
      ...(report.reason ? { reason: report.reason } : {}),
    };
    // Use the raw request so a 429 (daily-cap reached) does NOT throw — the
    // background runner reads `status` to stop the drain gracefully. Other
    // non-2xx still surface as an error to the caller.
    const { ok, status, body: resBody } = await this.requestRaw(
      `/api/apply-queue/${encodeURIComponent(report.id)}/result`,
      { method: "POST", body: JSON.stringify(body) },
    );
    if (!ok && status !== 429) {
      const msg =
        resBody && typeof resBody === "object" && "error" in resBody
          ? String((resBody as { error: unknown }).error)
          : `request failed (${status})`;
      throw new ApiError(status, msg);
    }
    return { ok, status };
  }

  /**
   * Read the user's BROWSER auto-apply settings (Karjoo server is authoritative
   * for the stored value). This is the EXTENSION/browser-level toggle only; it is
   * fully independent of the SERVER auto-apply toggle (Max/Max+, /api/server-auto-apply)
   * which the extension never reads or writes.
   * Contract: GET /api/auto-apply → { enabled, minScore }.
   *
   * IMPORTANT: that route is authed by the Karjoo WEB SESSION COOKIE
   * (getCurrentUser), not the extension bearer token. The extension's same-origin
   * fetch carries that cookie automatically when the user is also signed into
   * Karjoo on the web in this browser. If the cookie is absent (401) or the route
   * is missing (404), we fail CLOSED to { enabled:false } so nothing auto-applies
   * and the user manages consent on the dashboard.
   */
  async getAutoApplySettings(): Promise<AutoApplySettings> {
    const { ok, status, body } = await this.requestRaw("/api/auto-apply", { method: "GET" });
    if (!ok) {
      if (status === 401 || status === 404) {
        return { enabled: false, minScore: DEFAULT_AUTO_APPLY_MIN_SCORE };
      }
      throw new ApiError(status, errorOf(body, status));
    }
    const s = (body ?? {}) as ServerAutoApplySettings;
    return {
      enabled: s.enabled === true,
      minScore: typeof s.minScore === "number" ? s.minScore : DEFAULT_AUTO_APPLY_MIN_SCORE,
    };
  }

  /**
   * Update the user's auto-apply toggle / threshold (mirrors the popup control).
   * Contract: PUT /api/auto-apply { enabled?, minScore? } → { enabled, minScore }
   * (web-cookie authed — same caveat as the GET).
   */
  async setAutoApplySettings(
    next: Partial<AutoApplySettings> & { enabled: boolean },
  ): Promise<AutoApplySettings> {
    const body: { enabled: boolean; minScore?: number } = {
      enabled: next.enabled,
      ...(typeof next.minScore === "number" ? { minScore: next.minScore } : {}),
    };
    const { ok, status, body: resBody } = await this.requestRaw("/api/auto-apply", {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!ok) {
      // This route is authed by the Karjoo WEB cookie, not the extension bearer.
      // A 401/404 means the user isn't signed into Karjoo web (or the route is
      // old) — NOT that the extension session is dead. Throw a plain Error (not
      // ApiError) so the background's global 401 handler does NOT clear the token
      // and boot a validly-paired user to the pairing view; just show guidance.
      if (status === 401 || status === 404) {
        throw new Error(
          "برای تغییرِ «اپلای خودکار روی سرور» ابتدا در وبِ کارجو (داشبورد) وارد شوید.",
        );
      }
      throw new ApiError(status, errorOf(resBody, status));
    }
    const res = (resBody ?? {}) as ServerAutoApplySettings;
    return {
      enabled: res.enabled === true,
      minScore: typeof res.minScore === "number" ? res.minScore : DEFAULT_AUTO_APPLY_MIN_SCORE,
    };
  }

  /**
   * Read the user's plan tier (to decide whether the vault push is offered —
   * Max/Max+ only). Contract: GET /api/me/plan → { plan, ... } (web-cookie authed).
   * Fails CLOSED to 'free' (no vault push, session stays local) on 401/404/error.
   */
  async getPlan(): Promise<PlanTier> {
    try {
      const { ok, status, body } = await this.requestRaw("/api/me/plan", { method: "GET" });
      if (!ok) return "free";
      const plan = (body as { plan?: string } | null)?.plan;
      return plan === "pro" || plan === "max" || plan === "maxplus" ? plan : "free";
      void status;
    } catch {
      return "free";
    }
  }

  /**
   * Push the user's OWN refreshed session for a board into their OWN encrypted
   * server vault (premium only). Contract: POST /api/session/refresh (extension
   * bearer) { board, session, expiresAt? } → { board, sessionShape, lastRefreshed,
   * expiresAt }. The server encrypts `session` (AES-256-GCM) at rest; it is never
   * stored or returned in plain.
   *
   * THIS IS THE ONLY METHOD THAT TRANSMITS RAW SESSION MATERIAL — and only to the
   * vault endpoint, only the user's own session. Expected non-2xx are NON-fatal
   * (the snapshot stays LOCAL): 404 (route missing), 409 (board not connected yet),
   * 503 (vault not configured). Anything else throws.
   */
  async refreshSession(body: SessionRefreshBody): Promise<{ ok: boolean; status: number }> {
    const { ok, status, body: resBody } = await this.requestRaw("/api/session/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const tolerated = status === 404 || status === 409 || status === 503;
    if (!ok && !tolerated) {
      throw new ApiError(status, errorOf(resBody, status));
    }
    return { ok, status };
  }
}

/** Pull a server error message from a parsed body, or a generic fallback. */
function errorOf(body: unknown, status: number): string {
  return body && typeof body === "object" && "error" in body
    ? String((body as { error: unknown }).error)
    : `request failed (${status})`;
}
