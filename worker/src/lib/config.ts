/**
 * Worker-node runtime configuration — read ONCE from the environment.
 *
 * Everything that varies per deployment (control-plane URL, the one-time
 * enrollment token, this node's stable key/region, loop cadence, politeness
 * timing, the browser executable path, the update script) is an env var so the
 * node binary is deployment-agnostic.
 *
 * §10 guardrails that live here as config: the politeness delay+jitter and the
 * per-tick claim limit (the server enforces the real daily cap; this just bounds
 * how much we pull at once and how politely we space applies).
 */

/** Parsed, validated worker config. */
export interface WorkerConfig {
  /** Control-plane base URL, e.g. https://karjoo.ir (no trailing slash). */
  apiBase: string;
  /** One-time enrollment token (KARJOO_FLEET_ENROLLMENT_TOKEN). Required for first run. */
  enrollmentToken: string | null;
  /** This node's stable key — the upsert key the server recognizes it by. */
  nodeKey: string;
  /** IP class / region label reported to the server (e.g. "IR-residential"). */
  region: string | null;
  /** Agent version reported in heartbeats (for fleet-state visibility). */
  agentVersion: string;
  /** Where to persist the issued credential (file path). */
  credentialPath: string;
  /** Headful Playwright executable path (e.g. a system Chromium). Required to actually run a browser. */
  browserExecutablePath: string | null;
  /** Run the browser headless (default false — §10 prefers headful/real). */
  headless: boolean;
  /** Max jobs to claim per tick (server enforces the real daily cap). */
  claimLimit: number;
  /** Seconds between main loop ticks. */
  loopIntervalSec: number;
  /** Politeness: base delay (ms) between applies. */
  politenessBaseMs: number;
  /** Politeness: random jitter (ms) added to the base delay. */
  politenessJitterMs: number;
  /** Per-step Playwright timeout (ms). */
  stepTimeoutMs: number;
  /** The update script the server-commanded 'update' runs (pull+restart). */
  updateScript: string;
}

/** A source of env vars (process.env by default; injectable for tests). */
export type EnvSource = Record<string, string | undefined>;

const DEFAULTS = {
  region: null as string | null,
  agentVersion: "0.1.0",
  credentialPath: ".karjoo-worker/credential.json",
  headless: false,
  claimLimit: 5,
  loopIntervalSec: 60,
  // Server IPs are deliberately conservative. Extension execution has no
  // artificial delay because it uses the user's own foreground browser/IP.
  politenessBaseMs: 45_000,
  politenessJitterMs: 45_000,
  stepTimeoutMs: 15000,
  updateScript: "./update.sh",
} as const;

function num(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

/** Raised when a REQUIRED config var is missing (fail fast at startup). */
export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

/**
 * Build the worker config from an env source. Throws WorkerConfigError when a
 * required field (apiBase, nodeKey) is missing. The enrollment token may be absent
 * AFTER first run (the node then authenticates with the persisted credential).
 */
export function loadConfig(env: EnvSource = process.env): WorkerConfig {
  const apiBase = (env.KARJOO_API ?? env.KARJOO_API_BASE ?? "").trim().replace(/\/+$/, "");
  if (!apiBase) {
    throw new WorkerConfigError("KARJOO_API (control-plane base URL) is required.");
  }
  const nodeKey = (env.KARJOO_NODE_KEY ?? "").trim();
  if (!nodeKey) {
    throw new WorkerConfigError("KARJOO_NODE_KEY (this node's stable key) is required.");
  }

  const enrollmentToken = (env.KARJOO_FLEET_ENROLLMENT_TOKEN ?? "").trim() || null;

  return {
    apiBase,
    enrollmentToken,
    nodeKey,
    region: (env.KARJOO_NODE_REGION ?? "").trim() || DEFAULTS.region,
    agentVersion: (env.KARJOO_AGENT_VERSION ?? "").trim() || DEFAULTS.agentVersion,
    credentialPath: (env.KARJOO_CREDENTIAL_PATH ?? "").trim() || DEFAULTS.credentialPath,
    browserExecutablePath:
      (env.KARJOO_BROWSER_PATH ?? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "").trim() || null,
    headless: bool(env.KARJOO_HEADLESS, DEFAULTS.headless),
    claimLimit: Math.max(1, Math.min(25, num(env.KARJOO_CLAIM_LIMIT, DEFAULTS.claimLimit))),
    loopIntervalSec: Math.max(5, num(env.KARJOO_LOOP_INTERVAL_SEC, DEFAULTS.loopIntervalSec)),
    politenessBaseMs: Math.max(0, num(env.KARJOO_POLITENESS_BASE_MS, DEFAULTS.politenessBaseMs)),
    politenessJitterMs: Math.max(0, num(env.KARJOO_POLITENESS_JITTER_MS, DEFAULTS.politenessJitterMs)),
    stepTimeoutMs: Math.max(1000, num(env.KARJOO_STEP_TIMEOUT_MS, DEFAULTS.stepTimeoutMs)),
    updateScript: (env.KARJOO_FLEET_UPDATE_SCRIPT ?? "").trim() || DEFAULTS.updateScript,
  };
}

/** Compute a politeness delay (base + uniform jitter) for one apply. */
export function politenessDelayMs(
  cfg: Pick<WorkerConfig, "politenessBaseMs" | "politenessJitterMs">,
  rand: () => number = Math.random,
): number {
  return cfg.politenessBaseMs + Math.floor(rand() * (cfg.politenessJitterMs + 1));
}
