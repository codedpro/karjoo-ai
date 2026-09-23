/**
 * politeFetch — the three promises the public crawler makes to every site.
 * If any of these regress, the node becomes the kind of bot boards ban.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KARJOO_USER_AGENT, RobotsDisallowedError, politeFetch } from "./http.js";
import { clearRobotsCache } from "./robots.js";

function recorder(robots = "User-agent: *\nDisallow: /private/") {
  const calls: { url: string; ua: string | null; cookie: string | null; at: number }[] = [];
  let clock = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.endsWith("/robots.txt")) return new Response(robots, { status: 200 });
    calls.push({ url, ua: headers.get("user-agent"), cookie: headers.get("cookie"), at: clock });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  return {
    calls,
    fetchImpl,
    // Advance the clock on a LATER tick, like a real timer. An instant fake lets a
    // later request's wait advance the clock before an earlier request has been
    // sent, which stamps sends with the wrong time.
    sleep: (ms: number) =>
      new Promise<void>((resolve) =>
        setImmediate(() => {
          clock += ms;
          resolve();
        }),
      ),
    now: () => clock,
  };
}

beforeEach(() => clearRobotsCache());

describe("politeFetch", () => {
  it("identifies itself as KarjooBot and never sends cookies", async () => {
    const r = recorder();
    const f = politeFetch({ fetchImpl: r.fetchImpl, sleep: r.sleep, now: r.now });
    await f("https://board.example/jobs", { headers: { cookie: "session=SECRET" } });
    expect(r.calls[0]!.ua).toBe(KARJOO_USER_AGENT);
    expect(r.calls[0]!.ua).toContain("KarjooBot");
    expect(r.calls[0]!.cookie).toBeNull();
  });

  it("refuses a robots-disallowed URL WITHOUT requesting it", async () => {
    const r = recorder();
    const f = politeFetch({ fetchImpl: r.fetchImpl, sleep: r.sleep, now: r.now });
    await expect(f("https://board.example/private/x")).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(r.calls).toHaveLength(0);
  });

  it("honours a site-wide Disallow (JobVision's API host)", async () => {
    const r = recorder("User-Agent: *\nDisallow: /");
    const f = politeFetch({ fetchImpl: r.fetchImpl, sleep: r.sleep, now: r.now });
    await expect(f("https://api.example/v1/JobPost/List")).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
  });

  it("spaces requests to one host even when fired concurrently", async () => {
    // e-estekhdam fetches a page's details with Promise.all — the burst case.
    const r = recorder();
    const f = politeFetch({ fetchImpl: r.fetchImpl, sleep: r.sleep, now: r.now, minGapMs: 1_500 });
    await Promise.all(Array.from({ length: 5 }, (_, i) => f(`https://board.example/job/${i}`)));
    const times = r.calls.map((c) => c.at);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1_500);
    }
  });

  it("does not slow down requests to different hosts", async () => {
    const r = recorder();
    const f = politeFetch({ fetchImpl: r.fetchImpl, sleep: r.sleep, now: r.now, minGapMs: 1_500 });
    await f("https://a.example/x");
    await f("https://b.example/x");
    expect(r.calls.map((c) => c.at)).toEqual([0, 0]);
  });
});
