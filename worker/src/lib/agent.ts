/**
 * The worker agent — orchestrates ONE tick and the main loop.
 *
 * Per tick (the order matters):
 *   1. heartbeat (health + agentVersion → the server sees fleet state),
 *   2. claim jobs for this node's assigned users (server-gated),
 *   3. process each job (inject session → fill+submit → report → discard), with a
 *      politeness delay+jitter BETWEEN applies, stopping early if the server signals
 *      the daily cap (HTTP 429 on a result),
 *   4. poll + execute server commands (update/restart).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 GUARDRAILS surfaced here:
 *   • The DAILY CAP is the server's: a result POST returning 429 STOPS the drain
 *     for this tick (we do not keep applying past the cap).
 *   • POLITENESS: a delay+jitter between applies (account-safety + politeness).
 *   • The session lives only inside processJob (in-memory, discarded) — the agent
 *     never logs it; it only sees the non-secret result report.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Everything impure (browser, sleep, script runner, exit) is injected so a tick is
 * unit-tested end-to-end with no browser and no network.
 */
import type { KarjooFleetApi } from "./api-client.js";
import type { WorkerConfig } from "./config.js";
import { politenessDelayMs } from "./config.js";
import { processJob, type ProcessOptions } from "./processor.js";
import { processCommands, type CommandDeps } from "./commands.js";
import type { BrowserLauncher } from "./browser.js";
import type { FleetJob } from "./types.js";
import { Logger, logger as defaultLogger } from "./logger.js";

/** A sleep function (injectable; real one delays, the test one is instant). */
export type SleepFn = (ms: number) => Promise<void>;

/** Everything a tick needs that the agent does not own. */
export interface AgentDeps {
  api: KarjooFleetApi;
  cfg: WorkerConfig;
  launchBrowser: BrowserLauncher;
  /** Script runner for 'update' commands. */
  runScript: CommandDeps["runScript"];
  /** Restart hook for 'restart' commands (default process.exit). */
  restart?: CommandDeps["restart"];
  sleep?: SleepFn;
  logger?: Logger;
  /** Randomness for politeness jitter (injectable for deterministic tests). */
  rand?: () => number;
  /** Disable screenshots (tests). */
  captureScreenshot?: boolean;
  /** Watchdog deadline for one tick (injectable for tests). */
  tickTimeoutMs?: number;
}

/** Summary of one tick (for logging/tests). */
export interface TickResult {
  claimed: number;
  submitted: number;
  skipped: number;
  failed: number;
  blocked: number;
  /** True when the server signalled the daily cap (429) mid-drain. */
  capReached: boolean;
  /** True when a command requested a restart (the loop should stop). */
  restarted: boolean;
}

/** A real sleep (used by runLoop; tests inject an instant one). */
export const realSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run ONE tick: heartbeat → claim → process (with politeness + cap-stop) → commands.
 * Never throws — each phase is guarded so a transient error does not kill the loop.
 */
export async function runTick(deps: AgentDeps): Promise<TickResult> {
  const log = deps.logger ?? defaultLogger;
  const sleep = deps.sleep ?? realSleep;
  const rand = deps.rand ?? Math.random;
  const { api, cfg } = deps;

  const result: TickResult = {
    claimed: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    blocked: 0,
    capReached: false,
    restarted: false,
  };

  // 1) Heartbeat (non-fatal).
  try {
    await api.heartbeat({ health: "online", agentVersion: cfg.agentVersion });
  } catch (err) {
    log.warn("heartbeat failed", { error: errMessage(err) });
  }

  // 2) Claim jobs (non-fatal — empty on failure).
  let jobs: FleetJob[];
  try {
    jobs = await api.claim(cfg.claimLimit);
  } catch (err) {
    log.warn("claim failed", { error: errMessage(err) });
    jobs = [];
  }
  result.claimed = jobs.length;
  if (jobs.length > 0) {
    log.info("claimed jobs", { count: jobs.length });
  }

  const processOpts: ProcessOptions = {
    launchBrowser: deps.launchBrowser,
    headless: cfg.headless,
    executablePath: cfg.browserExecutablePath,
    stepTimeoutMs: cfg.stepTimeoutMs,
    logger: log,
    captureScreenshot: deps.captureScreenshot,
  };

  // 3) Process each job; report the result; respect politeness + the daily cap.
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const report = await processJob(job, processOpts);

    const securityBlocked = isSiteSecurityChallenge(report.reason);
    if (report.status === "submitted") result.submitted++;
    else if (report.status === "skipped") result.skipped++;
    else if (securityBlocked) result.blocked++;
    else result.failed++;

    // Report the result; the session is already discarded by processJob.
    let reported: { ok: boolean; status: number };
    try {
      reported = await api.reportResult(
        securityBlocked
          ? { ...report, status: "blocked" }
          : report,
      );
    } catch (err) {
      log.warn("report failed", { taskId: report.taskId, error: errMessage(err) });
      continue;
    }

    // 429 = the server's daily cap was hit → stop draining this tick.
    if (reported.status === 429) {
      log.info("daily cap reached (429); stopping drain for this tick");
      result.capReached = true;
      break;
    }
    if (securityBlocked) {
      log.warn("site security challenge detected; stopping drain for this tick", {
        taskId: report.taskId,
        reason: report.reason,
      });
      break;
    }

    // Politeness delay+jitter BETWEEN applies (not after the last).
    if (i < jobs.length - 1) {
      const delay = politenessDelayMs(cfg, rand);
      if (delay > 0) await sleep(delay);
    }
  }

  // 4) Poll + execute server commands.
  try {
    const commands = await api.pollCommands();
    if (commands.length > 0) {
      log.info("processing commands", { count: commands.length });
      const { restarted } = await processCommands(commands, api, cfg, {
        runScript: deps.runScript,
        restart: deps.restart,
        logger: log,
      });
      result.restarted = restarted;
    }
  } catch (err) {
    log.warn("command poll failed", { error: errMessage(err) });
  }

  return result;
}

/** A stop signal the loop checks each iteration (injectable for tests). */
export interface LoopControl {
  /** Return true to stop the loop after the current tick. */
  stopped(): boolean;
}

/**
 * The main loop: run a tick, sleep loopIntervalSec, repeat — until a restart
 * command fires or the control signals stop. Returns when the loop ends.
 */
/**
 * How long a single tick may take before we treat the loop as wedged.
 *
 * Why this exists: `runTick` awaits network and browser work, and a promise that
 * never settles stalls the `while` below forever — no error, no exit, no next tick.
 * That happened in production: the process stayed alive with zero open sockets and
 * stopped heartbeating for over an hour, and because the supervisor only checks that
 * *a process* exists, it never relaunched. A hung worker is worse than a dead one.
 */
export const TICK_TIMEOUT_MS = 10 * 60_000;

/** Resolves to `"timeout"` if the work outlives the deadline. */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
    // Never hold the process open just for the watchdog.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runLoop(
  deps: AgentDeps,
  control: LoopControl = { stopped: () => false },
): Promise<void> {
  const log = deps.logger ?? defaultLogger;
  const sleep = deps.sleep ?? realSleep;
  const tickTimeoutMs = deps.tickTimeoutMs ?? TICK_TIMEOUT_MS;
  log.info("worker loop starting", {
    nodeKey: deps.cfg.nodeKey,
    region: deps.cfg.region,
    agentVersion: deps.cfg.agentVersion,
    loopIntervalSec: deps.cfg.loopIntervalSec,
  });

  while (!control.stopped()) {
    let tick: TickResult;
    try {
      const outcome = await withDeadline(runTick(deps), tickTimeoutMs);
      if (outcome === "timeout") {
        // Exit rather than continue: whatever wedged the tick (a stuck browser, a
        // socket that never closes) is still holding resources, and a fresh process
        // from the supervisor is cheaper and more reliable than trying to unwind it.
        log.error("tick exceeded deadline; exiting so the supervisor restarts us", {
          tickTimeoutMs,
        });
        (deps.restart ?? (() => process.exit(1)))();
        return;
      }
      tick = outcome;
    } catch (err) {
      log.error("tick threw (continuing)", { error: errMessage(err) });
      await sleep(deps.cfg.loopIntervalSec * 1000);
      continue;
    }

    log.info("tick complete", {
      claimed: tick.claimed,
      submitted: tick.submitted,
      skipped: tick.skipped,
      failed: tick.failed,
      capReached: tick.capReached,
    });

    if (tick.restarted) {
      log.info("restart requested; ending loop");
      return;
    }
    if (control.stopped()) break;
    await sleep(deps.cfg.loopIntervalSec * 1000);
  }
  log.info("worker loop ended");
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSiteSecurityChallenge(reason: string | undefined): boolean {
  return reason?.startsWith("jobinja_security_check:") ?? false;
}
