/**
 * IranTalent discovery tests — parsing, pagination, exclusions, and the 45-day
 * limit, all against fixture payloads shaped like the live search/detail API.
 */
import { describe, it, expect } from "vitest";

import {
  discoverIranTalentListings,
  irantalentJobUrl,
  isActionableIranTalentRow,
  mapIranTalentPosition,
  normalizedGender,
  parseIranTalentDate,
} from "@ext/lib/irantalent-discovery";

const DAY = 86_400_000;

/** Tehran wall-clock, the format the list endpoint returns. */
function livedAt(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY + 3.5 * 3_600_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 182341,
    title: "Process Assistant Manager",
    title_farsi: "معاون مدیر فرآیندها",
    slug: "process-assistant-manager",
    lived_at: livedAt(1),
    status: { id: 170, title: "Live-approved" },
    is_applied: false,
    is_crawler: false,
    redirection_url: null,
    work_type: "on_site",
    location_text_farsi: "تهران",
    is_show_salary: false,
    employer: { name_farsi: "یونیلیور", name: "Unilever Iran" },
    role_description_farsi: "<p>شرح&nbsp;نقش<br />خط دوم</p>",
    ...overrides,
  };
}

function page(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    current_page: 1,
    last_page: 1,
    next_page_url: null,
    total: rows.length,
    data: rows,
    ...extra,
  };
}

describe("parseIranTalentDate", () => {
  it("reads the list endpoint's Tehran wall-clock as +03:30", () => {
    expect(parseIranTalentDate("2026-08-31 14:40:30")).toBe("2026-08-31T11:10:30.000Z");
  });
  it("passes an ISO detail timestamp through", () => {
    expect(parseIranTalentDate("2026-08-31T11:10:30.000000Z")).toBe("2026-08-31T11:10:30.000Z");
  });
  it("rejects junk", () => {
    expect(parseIranTalentDate("")).toBeNull();
    expect(parseIranTalentDate("not-a-date")).toBeNull();
  });
});

describe("normalizedGender", () => {
  it("maps IranTalent's tri-state boolean to the Persian words the filter matches", () => {
    expect(normalizedGender(true)).toBe("آقا");
    expect(normalizedGender(false)).toBe("خانم");
    expect(normalizedGender(null)).toBeNull();
    expect(normalizedGender(undefined)).toBeNull();
  });
});

describe("irantalentJobUrl", () => {
  it("builds the canonical /job/:slug/:id route", () => {
    expect(irantalentJobUrl("senior-dev", 42)).toBe("https://www.irantalent.com/job/senior-dev/42");
  });
  it("falls back when the slug is missing", () => {
    expect(irantalentJobUrl(null, 42)).toBe("https://www.irantalent.com/job/job/42");
  });
});

describe("isActionableIranTalentRow", () => {
  it("accepts a live, unapplied, first-party posting", () => {
    expect(isActionableIranTalentRow(row())).toBe(true);
    expect(isActionableIranTalentRow(row({ status: { id: 169 } }))).toBe(true);
  });
  it("rejects closed, already-applied, crawled, and redirected postings", () => {
    expect(isActionableIranTalentRow(row({ status: { id: 171 } }))).toBe(false);
    expect(isActionableIranTalentRow(row({ is_applied: true }))).toBe(false);
    expect(isActionableIranTalentRow(row({ is_crawler: true }))).toBe(false);
    expect(isActionableIranTalentRow(row({ redirection_url: "https://elsewhere.example/job" }))).toBe(false);
  });
});

describe("mapIranTalentPosition", () => {
  it("prefers Persian fields, strips html, and keeps identity + posting time", () => {
    const listing = mapIranTalentPosition(row({ lived_at: "2026-08-31 14:40:30" }));
    expect(listing).toMatchObject({
      externalId: "182341",
      title: "معاون مدیر فرآیندها",
      company: "یونیلیور",
      city: "تهران",
      url: "https://www.irantalent.com/job/process-assistant-manager/182341",
      postedAt: "2026-08-31T11:10:30.000Z",
      gender: null,
      alreadyApplied: false,
      salary: null,
    });
    expect(listing?.description).toContain("شرح نقش");
    expect(listing?.description).not.toContain("<p>");
  });

  it("takes the gender restriction from the detail payload", () => {
    const listing = mapIranTalentPosition(row(), { data: { gender: false } });
    expect(listing?.gender).toBe("خانم");
  });

  it("only reports salary when the employer publishes it", () => {
    expect(mapIranTalentPosition(row({ salary_from: 10, salary_to: 20 }))?.salary).toBeNull();
    expect(
      mapIranTalentPosition(row({ is_show_salary: true, salary_from: 10, salary_to: 20 }))?.salary,
    ).toBe("10 - 20");
  });

  it("returns null without an id, a title, or a posting time", () => {
    expect(mapIranTalentPosition({ title: "x", lived_at: livedAt(1) })).toBeNull();
    expect(mapIranTalentPosition(row({ title: null, title_farsi: null }))).toBeNull();
    expect(mapIranTalentPosition(row({ lived_at: null }))).toBeNull();
  });
});

describe("discoverIranTalentListings", () => {
  function fetcher(pages: unknown[], details: Record<string, unknown> = {}) {
    const calls: { url: string; body?: unknown }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const detail = /\/employer\/position\/(\d+)$/.exec(url);
      if (detail) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: details[detail[1]!] ?? { gender: null } }),
        } as unknown as Response;
      }
      const index = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1) - 1;
      return {
        ok: true,
        status: 200,
        json: async () => pages[index] ?? page([]),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("maps live rows, newest first, and passes lookup ids as the search filter", async () => {
    const { impl, calls } = fetcher([
      page([row({ id: 1, lived_at: livedAt(3) }), row({ id: 2, lived_at: livedAt(1) })]),
    ]);
    const listings = await discoverIranTalentListings(
      { categoryKeys: ["342"], employmentTypeKeys: ["186"], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId)).toEqual(["2", "1"]);
    expect(calls[0]!.body).toEqual({ job_category_ids: [342], employment_type_ids: [186] });
    expect(calls[0]!.url).toContain("start_date=");
    expect(calls[0]!.url).toContain("end_date=");
  });

  it("drops postings older than the age limit and stops paginating past it", async () => {
    const { impl, calls } = fetcher([
      page([row({ id: 1, lived_at: livedAt(2) }), row({ id: 2, lived_at: livedAt(90) })], {
        last_page: 5,
        next_page_url: "…page=2",
      }),
      page([row({ id: 3, lived_at: livedAt(120) })]),
    ]);
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId)).toEqual(["1"]);
    expect(calls.filter((c) => c.url.includes("position/search"))).toHaveLength(1);
  });

  it("follows pages while everything is inside the window", async () => {
    const { impl } = fetcher([
      page([row({ id: 1, lived_at: livedAt(1) })], { last_page: 2, next_page_url: "…page=2" }),
      page([row({ id: 2, lived_at: livedAt(2) })], { last_page: 2, next_page_url: null }),
    ]);
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId)).toEqual(["1", "2"]);
  });

  it("excludes closed, applied, crawled, and off-site postings", async () => {
    const { impl } = fetcher([
      page([
        row({ id: 1 }),
        row({ id: 2, status: { id: 171 } }),
        row({ id: 3, is_applied: true }),
        row({ id: 4, is_crawler: true }),
        row({ id: 5, redirection_url: "https://elsewhere.example/job" }),
      ]),
    ]);
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId)).toEqual(["1"]);
  });

  it("drops a posting the detail endpoint reveals as redirected or already applied", async () => {
    const { impl } = fetcher(
      [page([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })])],
      {
        2: { apply_redirect_link: "https://elsewhere.example/apply" },
        3: { is_applied: true },
      },
    );
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId)).toEqual(["1"]);
  });

  it("enforces remote-only itself, because the API ignores work_type_ids", async () => {
    const { impl } = fetcher([
      page([
        row({ id: 1, work_type: "on_site" }),
        row({ id: 2, work_type: "remote" }),
        row({ id: 3, work_type: "hybrid" }),
      ]),
    ]);
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: true, maxAgeDays: 45 },
      impl,
    );
    expect(listings.map((l) => l.externalId).sort()).toEqual(["2", "3"]);
  });

  it("sends the bearer token only when one was supplied", async () => {
    const seen: (string | undefined)[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? undefined);
      return {
        ok: true,
        status: 200,
        json: async () => (/position\/\d+$/.test(url) ? { data: {} } : page([row({ id: 1 })])),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45, authorization: "Bearer t" },
      impl,
    );
    expect(seen[0]).toBe("Bearer t");
  });

  it("reports login and rate-limit failures with classified reasons", async () => {
    const status = (code: number) =>
      (async () => ({ ok: false, status: code, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const options = { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 };
    await expect(discoverIranTalentListings(options, status(401))).rejects.toThrow(/irantalent_login_required/);
    await expect(discoverIranTalentListings(options, status(429))).rejects.toThrow(/irantalent_security_challenge/);
    await expect(discoverIranTalentListings(options, status(500))).rejects.toThrow(/irantalent_discovery_failed/);
  });

  it("flags a changed search contract instead of reporting an empty day", async () => {
    const impl = (async () =>
      ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as unknown as Response) as unknown as typeof fetch;
    await expect(discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    )).rejects.toThrow(/irantalent_provider_changed/);
  });

  it("treats a genuinely empty result page as no jobs, not a contract change", async () => {
    const impl = (async () =>
      ({ ok: true, status: 200, json: async () => page([]) }) as unknown as Response) as unknown as typeof fetch;
    await expect(discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    )).resolves.toEqual([]);
  });

  it("keeps a listing when its detail fetch fails, rather than losing the job", async () => {
    const impl = (async (url: string) => {
      if (/position\/\d+$/.test(url)) throw new Error("network");
      return { ok: true, status: 200, json: async () => page([row({ id: 1 })]) } as unknown as Response;
    }) as unknown as typeof fetch;
    const listings = await discoverIranTalentListings(
      { categoryKeys: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45 },
      impl,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]!.gender).toBeNull();
  });
});
