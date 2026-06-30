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

import { runTick, type AgentDeps } from "./agent.js";
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
