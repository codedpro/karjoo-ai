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
