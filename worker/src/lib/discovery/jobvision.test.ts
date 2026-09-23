/**
 * JobVision via its sitemap + schema.org JobPosting. The fixture is a real
 * posting page. Matching must be exact: a wrong match puts the user's name on a
 * job they never asked for.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  JOBVISION_SITEMAP_URL,
  JobvisionFeed,
  matchesJobvisionSpec,
  parseJobPostingPage,
  parseJobpostsSitemap,
  type JobvisionPosting,
} from "./jobvision.js";

const POSTING = readFileSync(join(__dirname, "__fixtures__", "jobvision-posting.html"), "utf8");
const URL_ = "https://jobvision.ir/jobs/231098/x";

describe("parseJobPostingPage (real page)", () => {
  it("reads the exact structured fields", () => {
    const p = parseJobPostingPage(POSTING, URL_, "231098")!;
    expect(p).toMatchObject({
      externalId: "231098",
      title: "حسابدار فروش",
      company: "بازرگانی اتحاد",
      category: "مالی و حسابداری",
      employmentType: "full-time",
      remote: false,
    });
    expect(new Date(p.postedAt).toISOString()).toBe(p.postedAt);
  });

  it("returns null for a page with no JobPosting", () => {
    expect(parseJobPostingPage("<html></html>", URL_, "1")).toBeNull();
  });
});

describe("parseJobpostsSitemap", () => {
  it("reads ids and lastmods and skips non-job rows", () => {
    const xml = `<urlset>
      <url><loc>https://jobvision.ir/jobs/111/a</loc><lastmod>2026-09-20T10:00:00Z</lastmod></url>
      <url><loc>https://jobvision.ir/companies/9</loc><lastmod>2026-09-20T10:00:00Z</lastmod></url>
      <url><loc>https://jobvision.ir/jobs/222/b&amp;c</loc><lastmod>bad</lastmod></url></urlset>`;
    expect(parseJobpostsSitemap(xml)).toEqual([
      { id: "111", url: "https://jobvision.ir/jobs/111/a", lastmod: Date.parse("2026-09-20T10:00:00Z") },
    ]);
  });
});

function posting(over: Partial<JobvisionPosting> = {}): JobvisionPosting {
  return {
    externalId: "1",
    title: "برنامه نویس",
    url: "https://jobvision.ir/jobs/1",
    postedAt: "2026-09-20T00:00:00.000Z",
    category: "توسعه نرم افزار و برنامه نویسی",
    employmentType: "full-time",
    remote: true,
    ...over,
  };
}

describe("matchesJobvisionSpec", () => {
  const spec = { categoryLabels: ["توسعه نرم افزار و برنامه نویسی"], employmentTypeKeys: [], remoteOnly: false };

  it("matches the exact category label", () => {
    expect(matchesJobvisionSpec(posting(), spec)).toBe(true);
  });

  it("rejects a neighbouring category — no fuzzy title guessing", () => {
    expect(matchesJobvisionSpec(posting({ category: "تست نرم افزار" }), spec)).toBe(false);
    expect(matchesJobvisionSpec(posting({ category: null }), spec)).toBe(false);
  });

  it("tolerates zero-width non-joiners in labels", () => {
    expect(
      matchesJobvisionSpec(posting({ category: "توسعه نرم‌افزار و برنامه نویسی" }), {
        ...spec,
        categoryLabels: ["توسعه نرم افزار و برنامه نویسی"],
      }),
    ).toBe(true);
  });

  it("applies remote-only and employment type like the extension does", () => {
    expect(matchesJobvisionSpec(posting({ remote: false }), { ...spec, remoteOnly: true })).toBe(false);
    expect(matchesJobvisionSpec(posting(), { ...spec, employmentTypeKeys: ["part-time"] })).toBe(false);
    expect(matchesJobvisionSpec(posting(), { ...spec, employmentTypeKeys: ["full-time"] })).toBe(true);
  });
});

describe("JobvisionFeed", () => {
  const NOW = Date.parse("2026-09-23T00:00:00Z");
  const sitemap = (lastmod: string) =>
    `<urlset><url><loc>https://jobvision.ir/jobs/231098/x</loc><lastmod>${lastmod}</lastmod></url></urlset>`;

  function stubFetch(sitemapXml: () => string) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === JOBVISION_SITEMAP_URL) return new Response(sitemapXml());
      return new Response(POSTING);
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it("fetches a posting once, then only again when its lastmod changes", async () => {
    let lastmod = "2026-09-20T00:00:00Z";
    const fetchImpl = stubFetch(() => sitemap(lastmod));
    const feed = new JobvisionFeed(fetchImpl);

    expect(await feed.refresh({ maxAgeDays: 45, now: () => NOW })).toHaveLength(1);
    expect(await feed.refresh({ maxAgeDays: 45, now: () => NOW })).toHaveLength(0);
    lastmod = "2026-09-21T00:00:00Z";
    expect(await feed.refresh({ maxAgeDays: 45, now: () => NOW })).toHaveLength(1);
  });

  it("keeps a window so a user whose turn came later still sees earlier postings", async () => {
    const feed = new JobvisionFeed(stubFetch(() => sitemap("2026-09-20T00:00:00Z")));
    await feed.refresh({ maxAgeDays: 45, now: () => NOW });
    await feed.refresh({ maxAgeDays: 45, now: () => NOW }); // delta is now empty…
    expect(feed.window(45, NOW)).toHaveLength(1); // …but the posting is retained
  });

  it("bounds a cold start", async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      `<url><loc>https://jobvision.ir/jobs/${1000 + i}/x</loc><lastmod>2026-09-20T00:00:00Z</lastmod></url>`,
    ).join("");
    const fetchImpl = stubFetch(() => `<urlset>${many}</urlset>`);
    await new JobvisionFeed(fetchImpl).refresh({ maxAgeDays: 45, maxPagesPerRun: 10, now: () => NOW });
    // 1 sitemap + at most 10 posting pages.
    expect(fetchImpl.mock.calls.length).toBe(11);
  });
});

describe("JobvisionFeed — concurrent refresh", () => {
  it("shares one refresh between the user and catalog passes", async () => {
    let sitemapFetches = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === JOBVISION_SITEMAP_URL) {
        sitemapFetches += 1;
        return new Response(
          `<urlset><url><loc>https://jobvision.ir/jobs/231098/x</loc><lastmod>2026-09-20T00:00:00Z</lastmod></url></urlset>`,
        );
      }
      return new Response(POSTING);
    }) as unknown as typeof fetch;
    const feed = new JobvisionFeed(fetchImpl);
    const opts = { maxAgeDays: 45, now: () => Date.parse("2026-09-23T00:00:00Z") };
    const [a, b] = await Promise.all([feed.refresh(opts), feed.refresh(opts)]);
    expect(sitemapFetches).toBe(1); // the 26 MB sitemap, once
    expect(a).toBe(b);
  });
});
