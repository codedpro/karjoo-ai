/**
 * DiscoveryRunner — the scheduling and back-off behaviour around the crawlers.
 */
import { describe, expect, it, vi } from "vitest";

import { Logger } from "../logger.js";
import type { FleetDiscoveryUser } from "../types.js";
import { RobotsDisallowedError } from "./http.js";
import { DiscoveryRunner, isBoardPushback, type DiscoveryApi } from "./runner.js";

const silent = new Logger({ write: () => {} } as never);

function api(users: FleetDiscoveryUser[] = []) {
  const submitted: Array<{ scope: string; userId?: string; board: string; count: number }> = [];
  const impl: DiscoveryApi = {
    claimDiscovery: vi.fn(async () => users),
    submitDiscovery: vi.fn(async (input) => {
      submitted.push({ scope: input.scope, userId: input.userId, board: input.board, count: input.listings.length });
      return { ingested: input.listings.length, queued: input.listings.length };
    }),
  };
  return { impl, submitted };
}

const karboomUser: FleetDiscoveryUser = {
  userId: "u1",
  maxAgeDays: 45,
  boards: [{ board: "karboom", enabled: true, hasTargeting: true, categoryKeys: ["programming-and-software"] }],
};

const KARBOOM_PAGE = `<div class="js-job-position-card js-job-card" data-href="https://karboom.io/jobs/abc123/dev">
  <div data-url="https://karboom.io/jobs/details/abc123"><a title="استخدام برنامه نویس" href="https://karboom.io/jobs/abc123/dev"></a>
  <span class="company-name">Acme</span><span class="pull-right">تهران</span><p class="date">امروز</p></div></div>`;

describe("isBoardPushback", () => {
  it("recognises rate limits and security checks, not ordinary failures", () => {
    expect(isBoardPushback("jobinja_rate_limited: discovery throttled")).toBe(true);
    expect(isBoardPushback("jobinja_security_check: discovery blocked")).toBe(true);
    expect(isBoardPushback("karboom_discovery_failed: 429")).toBe(true);
    expect(isBoardPushback("karboom_discovery_failed: 500")).toBe(false);
  });
});

describe("DiscoveryRunner.runUsers", () => {
  it("searches each due user's boards and queues the results for THAT user", async () => {
    const { impl, submitted } = api([karboomUser]);
    let served = false;
    const fetchImpl = vi.fn(async () => {
      if (served) return new Response(""); // page 2 empty → stop
      served = true;
      return new Response(KARBOOM_PAGE);
    }) as unknown as typeof fetch;
    const summary = await new DiscoveryRunner(impl, fetchImpl, silent).runUsers();
    expect(summary.users).toBe(1);
    expect(submitted).toEqual([{ scope: "user", userId: "u1", board: "karboom", count: 1 }]);
  });

  it("does nothing when the server says no one is due", async () => {
    const { impl, submitted } = api([]);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await new DiscoveryRunner(impl, fetchImpl, silent).runUsers();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(submitted).toHaveLength(0);
  });

  it("stops asking a board that pushed back — for every user, for a while", async () => {
    const { impl } = api([karboomUser, { ...karboomUser, userId: "u2" }]);
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    let clock = 1_000;
    const runner = new DiscoveryRunner(impl, fetchImpl, silent, { now: () => clock });

    const summary = await runner.runUsers();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // u2 never hit the board
    expect(summary.skipped["karboom:pushback"]).toBe(1);
    expect(summary.skipped["karboom:cooling_down"]).toBe(1);
    expect(runner.cooling("karboom")).toBe(true);

    clock += 31 * 60_000;
    expect(runner.cooling("karboom")).toBe(false);
  });

  it("treats a robots.txt refusal as 'not ours to crawl', not as a failure", async () => {
    const { impl } = api([karboomUser]);
    const fetchImpl = vi.fn(async () => {
      throw new RobotsDisallowedError("https://karboom.io/jobs/x");
    }) as unknown as typeof fetch;
    const runner = new DiscoveryRunner(impl, fetchImpl, silent);
    const summary = await runner.runUsers();
    expect(summary.skipped["karboom:robots_disallowed"]).toBe(1);
    expect(runner.cooling("karboom")).toBe(false);
  });
});

describe("DiscoveryRunner — budget", () => {
  it("gives every board its own slice, so one slow board cannot starve the rest", async () => {
    // Regression: one shared budget let e-estekhdam + the JobVision refresh eat
    // it all, and IranTalent and Karboom — last in line — were never searched.
    const boards = ["e-estekhdam", "irantalent", "karboom"] as const;
    const user: FleetDiscoveryUser = {
      userId: "u1",
      maxAgeDays: 45,
      boards: boards.map((board) => ({ board, enabled: true, hasTargeting: true, categoryKeys: ["x"] })),
    };
    const { impl } = api([user]);
    let clock = 0;
    const hosts = new Set<string>();
    // Every request "takes" 10 minutes — far past any single slice.
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      hosts.add(new URL(String(input)).host);
      clock += 10 * 60_000;
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;
    const summary = await new DiscoveryRunner(impl, fetchImpl, silent, { now: () => clock }).runUsers();
    expect(summary.boards).toBe(3);
    // Every board was actually reached.
    expect(hosts.size).toBe(3);
  });
});
