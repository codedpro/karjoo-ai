/**
 * Agent tick tests — the full claim→process→report→commands flow, end to end,
 * with the browser, network, sleep, and script runner all MOCKED.
 *
 * Covers:
 *   • a tick heartbeats, claims, processes each job, reports each result, and runs
 *     commands;
 *   • the §10 DAILY CAP: a result returning 429 STOPS the drain for the tick;
 *   • politeness: a sleep happens BETWEEN applies (jitter injected deterministically);
 *   • a scaffold-board job is reported as 'skipped' (not submitted);
 *   • the decrypted session never reaches a log line in a full tick;
 *   • a transient claim failure does not crash the tick.
 */
import { describe, expect, it, vi } from "vitest";

import { runLoop, runTick, type AgentDeps } from "./agent.js";
import { KarjooFleetApi } from "./api-client.js";
import { loadConfig, type WorkerConfig } from "./config.js";
import { Logger, type LogLevel } from "./logger.js";
import { makeFakeBrowser } from "../test/fake-browser.js";
import type { FleetJob, WorkerCommand } from "./types.js";

const LISTING = "https://jobinja.ir/companies/acme/jobs/AB12cd";

function cfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig({ KARJOO_API: "https://k.test", KARJOO_NODE_KEY: "n1" }),
    claimLimit: 5,
    politenessBaseMs: 100,
    politenessJitterMs: 0,
    ...over,
  };
}

function jobinjaJob(id: string, over: Partial<FleetJob> = {}): FleetJob {
  return {
    taskId: id,
    userId: "u1",
    board: "jobinja",
    listingUrl: LISTING,
    coverLetter: "متن انگیزه‌نامه",
    session: JSON.stringify({
      cookies: [{ name: "JOBINJA_SESSION", value: `SECRET-${id}`, domain: ".jobinja.ir" }],
      userAgent: "KarjooUA",
    }),
    ...over,
  };
}

/** Build a fake api with scripted claim/report/command behavior. */
function fakeApi(opts: {
  jobs: FleetJob[];
  reportStatuses?: number[]; // per-report HTTP status (default 200)
  commands?: WorkerCommand[];
}) {
  const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl: vi.fn() });
  const reported: { taskId: string; status: string }[] = [];
  let reportIdx = 0;

  api.heartbeat = vi.fn(async () => {});
  api.claim = vi.fn(async () => opts.jobs);
  api.reportResult = vi.fn(async (report) => {
    const status = opts.reportStatuses?.[reportIdx] ?? 200;
    reportIdx++;
    reported.push({ taskId: report.taskId, status: report.status });
    return { ok: status < 400, status };
  });
  api.pollCommands = vi.fn(async () => opts.commands ?? []);
  api.ackCommand = vi.fn(async () => {});
  return { api, reported };
}

function captureLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: new Logger({ write: (_l: LogLevel, line: string) => void lines.push(line) }, () => "T"),
  };
}

function deps(api: KarjooFleetApi, over: Partial<AgentDeps> = {}): AgentDeps {
  const { launcher } = makeFakeBrowser({ finalUrl: `${LISTING}?ok=1` });
  return {
    api,
    cfg: cfg(),
    launchBrowser: launcher,
    runScript: vi.fn(async () => ({ code: 0 })),
    sleep: vi.fn(async () => {}),
    rand: () => 0,
    captureScreenshot: false,
    ...over,
  };
}

describe("runTick — happy path", () => {
  it("heartbeats, claims, processes, and reports each job", async () => {
    const { api, reported } = fakeApi({ jobs: [jobinjaJob("t1"), jobinjaJob("t2")] });
    const d = deps(api);
    const res = await runTick(d);

    expect(api.heartbeat).toHaveBeenCalledOnce();
    expect(res.claimed).toBe(2);
    expect(res.submitted).toBe(2);
    expect(reported.map((r) => r.taskId)).toEqual(["t1", "t2"]);
    expect(reported.every((r) => r.status === "submitted")).toBe(true);
  });

  it("sleeps BETWEEN applies (politeness) but not after the last", async () => {
    const { api } = fakeApi({ jobs: [jobinjaJob("t1"), jobinjaJob("t2"), jobinjaJob("t3")] });
    const sleep = vi.fn(async () => {});
    await runTick(deps(api, { sleep }));
    // 3 jobs → 2 inter-apply sleeps.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100); // base 100 + jitter 0
  });
});

describe("runTick — §10 daily cap (429)", () => {
  it("stops draining once a result returns 429", async () => {
    const { api, reported } = fakeApi({
      jobs: [jobinjaJob("t1"), jobinjaJob("t2"), jobinjaJob("t3")],
      reportStatuses: [200, 429, 200], // second report hits the cap
    });
    const res = await runTick(deps(api));
    expect(res.capReached).toBe(true);
    // Only t1 and t2 were reported; t3 was NOT processed after the cap.
    expect(reported.map((r) => r.taskId)).toEqual(["t1", "t2"]);
  });
});

describe("runTick — site security challenge", () => {
  it("stops draining after the first Jobinja security-check page", async () => {
    const { launcher } = makeFakeBrowser({
      bodyText: "Checking your browser before accessing the website... Please complete the security check before accessing the website.",
      selectors: { "#apply-form": { waitForThrows: true } },
    });
    const { api, reported } = fakeApi({
      jobs: [jobinjaJob("t1"), jobinjaJob("t2"), jobinjaJob("t3")],
    });

    const res = await runTick(deps(api, { launchBrowser: launcher }));

    expect(res.claimed).toBe(3);
    expect(res.failed).toBe(0);
    expect(res.blocked).toBe(1);
    expect(reported).toEqual([{ taskId: "t1", status: "blocked" }]);
  });
});

describe("runTick — scaffold board", () => {
  it("reports a scaffold-board job as skipped (never submitted)", async () => {
    const { api, reported } = fakeApi({
      jobs: [jobinjaJob("t1", { board: "jobvision", listingUrl: "https://jobvision.ir/jobs/1" })],
    });
    const res = await runTick(deps(api));
    expect(res.skipped).toBe(1);
    expect(res.submitted).toBe(0);
    expect(reported[0]!.status).toBe("skipped");
  });
});

describe("runTick — commands", () => {
  it("runs an update command and reports restarted on a restart command", async () => {
    const { api } = fakeApi({
      jobs: [],
      commands: [{ id: "r1", command: "restart", payload: null }],
    });
    const restart = vi.fn();
    const res = await runTick(deps(api, { restart }));
    expect(res.restarted).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
  });
});

describe("runTick — resilience + §10 no-log-session", () => {
  it("does not crash when claim fails", async () => {
    const api = new KarjooFleetApi({ apiBase: "https://k.test", credential: "c", fetchImpl: vi.fn() });
    api.heartbeat = vi.fn(async () => {});
    api.claim = vi.fn(async () => {
      throw new Error("503");
    });
    api.pollCommands = vi.fn(async () => []);
    const res = await runTick(deps(api));
    expect(res.claimed).toBe(0);
  });

  it("emits no log line containing the decrypted session across a full tick", async () => {
    const { api } = fakeApi({ jobs: [jobinjaJob("t1"), jobinjaJob("t2")] });
    const { lines, logger } = captureLogger();
    await runTick(deps(api, { logger }));
    const all = lines.join("\n");
    expect(all).not.toContain("SECRET-t1");
    expect(all).not.toContain("SECRET-t2");
    expect(all).not.toContain("KarjooUA");
    expect(all).not.toContain("JOBINJA_SESSION");
  });
});

/**
 * نگهبانِ زمانِ tick.
 *
 * چرا لازم شد: در تولید یک tick هرگز تمام نشد. پروسه زنده ماند، هیچ سوکتِ بازی نداشت،
 * بیش از یک ساعت heartbeat نفرستاد — و چون سوپروایزر فقط «وجودِ پروسه» را می‌سنجید،
 * هیچ‌وقت نودِ تازه بالا نیاورد. ورکرِ هنگ‌کرده از ورکرِ مرده بدتر است.
 */
describe("runLoop — tick watchdog", () => {
  const silent = { info: () => {}, warn: () => {}, error: () => {} } as never;

  it("tickِ بی‌پایان → درخواستِ restart و پایانِ حلقه", async () => {
    let restarted = false;
    // heartbeat هرگز resolve نمی‌شود — دقیقاً همان چیزی که حلقه را در تولید قفل کرد.
    const api = { heartbeat: () => new Promise<never>(() => {}) } as never;
    const deps = {
      api,
      cfg: { nodeKey: "n", region: "r", agentVersion: "0", loopIntervalSec: 1 },
      launchBrowser: (() => {}) as never,
      runScript: (() => {}) as never,
      restart: () => {
        restarted = true;
      },
      sleep: async () => {},
      logger: silent,
      tickTimeoutMs: 20,
    } as never;

    const finished = await Promise.race([
      runLoop(deps).then(() => "ended"),
      new Promise((r) => setTimeout(() => r("still-running"), 900)),
    ]);
    expect(finished).toBe("ended");
    expect(restarted).toBe(true);
  });

  it("بدونِ هنگ، حلقه به کارش ادامه می‌دهد", async () => {
    let ticks = 0;
    let stop = false;
    const api = {
      heartbeat: async () => {
        ticks += 1;
        if (ticks >= 2) stop = true;
        return { ok: true };
      },
      claim: async () => [],
      pollCommands: async () => [],
    } as never;
    const deps = {
      api,
      cfg: { nodeKey: "n", region: "r", agentVersion: "0", loopIntervalSec: 0 },
      launchBrowser: (() => {}) as never,
      runScript: (() => {}) as never,
      restart: () => {
        throw new Error("must not restart on a healthy tick");
      },
      sleep: async () => {},
      logger: silent,
      tickTimeoutMs: 5_000,
    } as never;
    await runLoop(deps, { stopped: () => stop });
    expect(ticks).toBeGreaterThanOrEqual(2);
  });
});
