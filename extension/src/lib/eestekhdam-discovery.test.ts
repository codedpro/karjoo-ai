import { afterEach, describe, expect, it, vi } from "vitest";

import {
  discoverEEstekhdamListings,
  mapEEstekhdamDetail,
} from "@ext/lib/eestekhdam-discovery";

afterEach(() => vi.useRealTimers());

describe("e-estekhdam discovery", () => {
  it("maps detail data without session material", () => {
    const listing = mapEEstekhdamDetail(
      { id: 12, uuid: "abc12", ats: true, brand_name: "Company", url: "/kabc12-job" },
      { data: {
        id: 12,
        uuid: "abc12",
        shortTitle: "Backend Developer",
        date: "2026-08-16",
        ats: true,
        gender: "both",
        city: "تهران",
        employer: { name: "Company" },
        top: "<p>Build APIs</p>",
        otherqualifications: ["Python", "PostgreSQL"],
      } },
    );
    expect(listing).toMatchObject({
      externalId: "12",
      title: "Backend Developer",
      postedAt: "2026-08-16T00:00:00.000Z",
      description: "Build APIs\nPython\nPostgreSQL",
    });
    expect(JSON.stringify(listing)).not.toMatch(/cookie|token|authorization/i);
  });

  it("rejects a listing when either search or detail says no internal ATS form", () => {
    const search = { id: 12, uuid: "abc12", ats: 0, title: "Contact only" };
    const detail = {
      data: {
        id: 12,
        uuid: "abc12",
        shortTitle: "Contact only",
        date: "2026-08-16",
        ats: false,
      },
    };
    expect(mapEEstekhdamDetail(search, detail)).toBeNull();
  });

  it("imports only fresh ATS jobs and sends native filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    let searchBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/search-api/search?")) {
        searchBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: [
          { id: 1, uuid: "new01", ats: true, title: "Fresh", url: "/knew01-fresh" },
          { id: 2, uuid: "noats", ats: false, title: "Contact only" },
        ] }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: {
        id: 1,
        uuid: "new01",
        shortTitle: "Fresh",
        date: "2026-08-15",
        ats: true,
        employer: { name: "Company" },
      } }), { status: 200 });
    });
    const result = await discoverEEstekhdamListings({
      categoryKeys: ["برنامه-نویس"],
      cities: ["تهران"],
      employmentTypeKeys: ["تمام-وقت"],
      remoteOnly: true,
      maxAgeDays: 30,
    }, fetchMock as unknown as typeof fetch);
    expect(result.map((item) => item.externalId)).toEqual(["1"]);
    expect(searchBody).toMatchObject({
      position: ["برنامه-نویس"],
      where: ["تهران"],
      contract: ["تمام-وقت", "دورکاری"],
      posted: ["30"],
      sort: "جدیدترین",
    });
  });
});

describe("pagination budget — the bug that starved the apply loop", () => {
  /** A board that always returns a full, in-window page: without a bound this never ends. */
  function endlessBoard() {
    let served = 0;
    return (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/search-api/jobs/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ats: true,
              uuid: `u${served}`,
              id: served++,
              shortTitle: "Job",
              date: new Date().toISOString().slice(0, 10),
            },
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: Array.from({ length: 20 }, (_, i) => ({ ats: true, uuid: `u${served + i}` })),
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  const base = {
    categoryKeys: [], cities: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45,
  };

  it("stops at the listing ceiling instead of ingesting the whole board", async () => {
    const listings = await discoverEEstekhdamListings(
      { ...base, maxListings: 40 },
      endlessBoard(),
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.length).toBeLessThan(200);
  });

  it("stops once the tick's wall-clock budget is spent", async () => {
    const listings = await discoverEEstekhdamListings(
      { ...base, deadlineAt: Date.now() - 1 },
      endlessBoard(),
    );
    // The deadline is already past, so exactly one page is fetched and kept.
    expect(listings.length).toBeLessThanOrEqual(20);
  });

  it("is unbounded only when the caller asks for that", async () => {
    // Guard against the ceiling silently applying when no budget was given: the
    // page-size break still ends it, so this must terminate on a short page.
    const shortPage = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/search-api/jobs/")) {
        return {
          ok: true, status: 200,
          json: async () => ({ data: { ats: true, uuid: "u1", id: 1, shortTitle: "J", date: "2026-08-30" } }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({ data: [{ ats: true, uuid: "u1" }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await expect(discoverEEstekhdamListings(base, shortPage)).resolves.toHaveLength(1);
  });
});
