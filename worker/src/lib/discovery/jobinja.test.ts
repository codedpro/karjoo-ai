/**
 * Node-side Jobinja discovery. The parser is the control plane's, ported; these
 * pin what the node adds: ISO dates the ingest accepts, paging, and stopping.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  discoverJobinjaListings,
  jobinjaPageUrl,
  looksLikeJobinjaChallenge,
  parseSearchHtml,
} from "./jobinja.js";

const FIXTURE = readFileSync(join(__dirname, "__fixtures__", "jobinja-search.html"), "utf8");
const NOW = new Date("2026-09-23T06:00:00Z");

describe("parseSearchHtml", () => {
  it("parses real result cards into listings with ISO dates", () => {
    const listings = parseSearchHtml(FIXTURE, NOW);
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      // The control-plane ingest rejects anything that is not a real datetime.
      expect(new Date(listing.postedAt).toISOString()).toBe(listing.postedAt);
      expect(listing.url).toMatch(/^https:\/\/jobinja\.ir\//);
      expect(listing.externalId).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("does not repeat a listing that appears twice on a page", () => {
    const listings = parseSearchHtml(FIXTURE + FIXTURE, NOW);
    expect(new Set(listings.map((l) => l.externalId)).size).toBe(listings.length);
  });
});

describe("jobinjaPageUrl", () => {
  it("keeps every filter and only changes the page", () => {
    const first = "https://jobinja.ir/jobs?filters%5Bremote%5D=1&sort_by=published_at_desc";
    const second = new URL(jobinjaPageUrl(first, 2));
    expect(second.searchParams.get("page")).toBe("2");
    expect(second.searchParams.get("filters[remote]")).toBe("1");
    expect(second.searchParams.get("sort_by")).toBe("published_at_desc");
    expect(new URL(jobinjaPageUrl(first, 1)).searchParams.has("page")).toBe(false);
  });
});

describe("discoverJobinjaListings", () => {
  it("treats a security check as a stop, not something to retry", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>cf-chl- checking</html>")) as unknown as typeof fetch;
    expect(looksLikeJobinjaChallenge("<html>cf-chl-</html>")).toBe(true);
    await expect(
      discoverJobinjaListings("https://jobinja.ir/jobs", { maxAgeDays: 45 }, fetchImpl, NOW),
    ).rejects.toThrow(/jobinja_security_check/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops paging once a page reaches past the freshness cutoff", async () => {
    // One-day window: the fixture's cards are older, so page 1 ends the walk.
    const fetchImpl = vi.fn(async () => new Response(FIXTURE)) as unknown as typeof fetch;
    await discoverJobinjaListings("https://jobinja.ir/jobs", { maxAgeDays: 1 }, fetchImpl, NOW);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports rate limiting in words the runner recognises as pushback", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(
      discoverJobinjaListings("https://jobinja.ir/jobs", { maxAgeDays: 45 }, fetchImpl, NOW),
    ).rejects.toThrow(/rate_limited/);
  });
});
