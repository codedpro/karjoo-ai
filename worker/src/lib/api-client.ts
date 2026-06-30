/**
 * Karjoo control-plane API client (worker-node side).
 *
 * The ONLY module that talks to the control plane. It authenticates EVERY call
 * (except enroll) with the per-node credential as `Authorization: Bearer <cred>`.
 * `fetchImpl` is injectable so every method is unit-tested without a real network.
 *
 * Endpoint contract (Track A routes — the SERVER is the source of truth; this
 * client adapts to it and is tolerant of the response wrapper shape):
 *   POST /api/fleet/enroll      { enrollmentToken, nodeKey, region?, agentVersion?, ipAddress? }
 *                               → 201 { credential, node }
 *   POST /api/fleet/heartbeat   { health?, agentVersion?, ipAddress? } → { node }
 *   POST /api/fleet/claim       { limit? } → { jobs: FleetJob[] }   (the jobs carry the
 *                               server-DECRYPTED session — the ONE thing leaving the vault)
 *   POST /api/fleet/result      { taskId, userId, status, externalRef?, reason?, proof? }
 *   GET  /api/fleet/commands              → { commands: WorkerCommand[] }  (pending, oldest-first)
 *   POST /api/fleet/commands/:id/ack  { status, result? } → { command }
 *
 * SECURITY: the credential is sent only in the Authorization header, never logged.
 * The claim response's `session` material is handled by the caller in-memory and
 * NEVER passed to the logger.
 */
import type {
  FleetJob,
  FleetResultReport,
  WorkerCommand,
} from "./types.js";

export type FetchImpl = typeof fetch;

/** A raw, non-throwing response (status + parsed body) for branch-on-status logic. */
interface RawResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

/** Thrown for an unexpected non-2xx the caller did not explicitly tolerate. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  apiBase: string;
  /** The per-node credential (Bearer). Absent only before enrollment. */
  credential?: string | null;
  fetchImpl?: FetchImpl;
}

/** Enrollment result (the credential is returned ONCE here). */
export interface EnrollResponse {
  credential: string;
  /** The server node id (reference only — never trusted as auth). */
  nodeId: string;
}

export class KarjooFleetApi {
  private readonly apiBase: string;
  private credential: string | null;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: ApiClientOptions) {
    this.apiBase = opts.apiBase.replace(/\/+$/, "");
    this.credential = opts.credential ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /** Swap in the credential after enrollment (so subsequent calls authenticate). */
  setCredential(credential: string): void {
    this.credential = credential;
  }

  private async requestRaw(path: string, init: RequestInit = {}): Promise<RawResponse> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.credential) headers.set("authorization", `Bearer ${this.credential}`);

    const res = await this.fetchImpl(`${this.apiBase}${path}`, { ...init, headers });
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
      throw new ApiError(status, errorOf(body, status));
    }
    return body as T;
  }

  /**
   * Enroll this node (first run). The enrollment token authenticates the call (the
   * credential does not exist yet). Returns the credential ONCE — the caller
   * persists it and never asks again. A 503 means enrollment is closed
   * (KARJOO_FLEET_ENROLLMENT_TOKEN unset on the server) → fatal at startup.
   */
  async enroll(input: {
    enrollmentToken: string;
    nodeKey: string;
    region?: string | null;
    agentVersion?: string | null;
    ipAddress?: string | null;
  }): Promise<EnrollResponse> {
    const body: Record<string, unknown> = {
      enrollmentToken: input.enrollmentToken,
      nodeKey: input.nodeKey,
    };
    if (input.region) body.region = input.region;
    if (input.agentVersion) body.agentVersion = input.agentVersion;
    if (input.ipAddress) body.ipAddress = input.ipAddress;

    const res = await this.request<{ credential: string; node?: { id?: string } }>(
      "/api/fleet/enroll",
      { method: "POST", body: JSON.stringify(body) },
    );
    return { credential: res.credential, nodeId: res.node?.id ?? "" };
  }

  /** Report a heartbeat (health + agentVersion). Non-fatal on failure (caller logs/retries). */
  async heartbeat(input: {
    health?: "online" | "degraded" | "offline";
    agentVersion?: string;
    ipAddress?: string;
  }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (input.health) body.health = input.health;
    if (input.agentVersion) body.agentVersion = input.agentVersion;
    if (input.ipAddress) body.ipAddress = input.ipAddress;
    await this.request("/api/fleet/heartbeat", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Claim up to `limit` apply jobs for this node's ASSIGNED users (server-enforced:
   * only assigned users whose auto-apply gate passes, only above-threshold tasks).
   * Tolerant of the response wrapper: accepts `{ jobs }`, `{ items }`, or a bare array.
   *
   * The returned jobs carry the user's OWN decrypted session — used in-memory and
   * discarded. This client does not log them.
   */
  async claim(limit: number): Promise<FleetJob[]> {
    const res = await this.request<unknown>("/api/fleet/claim", {
      method: "POST",
      body: JSON.stringify({ limit }),
    });
    return extractJobs(res);
  }

  /**
   * Report a job result. Returns the HTTP status so the caller can detect the
   * daily-cap signal (429) and stop draining. A 404 means the task is not the
   * claimed user's (server rejects spoofed userId) — surfaced as ok:false.
   */
  async reportResult(report: FleetResultReport): Promise<{ ok: boolean; status: number }> {
    const body: Record<string, unknown> = {
      taskId: report.taskId,
      userId: report.userId,
      status: report.status,
    };
    if (report.externalRef) body.externalRef = report.externalRef;
    if (report.reason) body.reason = report.reason;
    if (report.proof) body.proof = report.proof;

    const { ok, status, body: resBody } = await this.requestRaw("/api/fleet/result", {
      method: "POST",
      body: JSON.stringify(body),
    });
    // 429 (cap) and 404 (not this user's task) are handled by the caller, not thrown.
    if (!ok && status !== 429 && status !== 404) {
      throw new ApiError(status, errorOf(resBody, status));
    }
    return { ok, status };
  }

  /**
   * Poll pending server commands (oldest-first). The control plane exposes this as a
   * GET (read-only; the node's id comes from the credential, not a body). Tolerant of
   * `{ commands }`/`{ items }`/array.
   */
  async pollCommands(): Promise<WorkerCommand[]> {
    const res = await this.request<unknown>("/api/fleet/commands", {
      method: "GET",
    });
    return extractCommands(res);
  }

  /** Acknowledge a command's progress/outcome. */
  async ackCommand(
    commandId: string,
    status: "acked" | "done" | "failed",
    result?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { status };
    if (result) body.result = result;
    await this.request(`/api/fleet/commands/${encodeURIComponent(commandId)}/ack`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

/** Pull a server error message from a parsed body, or a generic fallback. */
function errorOf(body: unknown, status: number): string {
  return body && typeof body === "object" && "error" in body
    ? String((body as { error: unknown }).error)
    : `request failed (${status})`;
}

/** Extract the jobs array from a tolerant set of wrapper shapes. */
export function extractJobs(res: unknown): FleetJob[] {
  if (Array.isArray(res)) return res as FleetJob[];
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.jobs)) return obj.jobs as FleetJob[];
    if (Array.isArray(obj.items)) return obj.items as FleetJob[];
  }
  return [];
}

/** Extract the commands array from a tolerant set of wrapper shapes. */
export function extractCommands(res: unknown): WorkerCommand[] {
  if (Array.isArray(res)) return res as WorkerCommand[];
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    if (Array.isArray(obj.commands)) return obj.commands as WorkerCommand[];
    if (Array.isArray(obj.items)) return obj.items as WorkerCommand[];
  }
  return [];
}
