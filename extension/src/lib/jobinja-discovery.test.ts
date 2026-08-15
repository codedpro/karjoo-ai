import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { parseJobinjaDiscoveryPage, postedAtFromJobinja } from "@ext/lib/jobinja-discovery";

describe("Jobinja browser discovery", () => {
  it("parses cards, Persian dates, canonical URLs, and pagination", () => {
    const { document } = parseHTML(`
      <html><head><link rel="next" href="/jobs?filters%5Bx%5D=y&page=2"></head><body>
        <li class="c-jobListView__item">
          <a class="c-jobListView__titleLink" href="/companies/acme/jobs/tO4x/test?_ref=16">توسعه دهنده</a>
          <span class="c-jobListView__passedDays">(۳ روز پیش)</span>
          <ul><li class="c-jobListView__metaItem"><span>اکمی</span></li><li class="c-jobListView__metaItem"><span>تهران</span></li></ul>
        </li>
      </body></html>
    `);
    const result = parseJobinjaDiscoveryPage(
      document as unknown as Document,
      "https://jobinja.ir/jobs?page=1",
      new Date("2026-08-11T12:00:00.000Z"),
    );
    expect(result.listings).toEqual([expect.objectContaining({
      externalId: "tO4x",
      company: "اکمی",
      city: "تهران",
      url: "https://jobinja.ir/companies/acme/jobs/tO4x/test",
      postedAt: "2026-08-08T12:00:00.000Z",
    })]);
    expect(result.nextUrl).toBe("https://jobinja.ir/jobs?filters%5Bx%5D=y&page=2");
  });

  it("detects security and visible bulk-apply UI", () => {
    const { document } = parseHTML("<html><body>Checking your browser before accessing <button>Bulk apply</button></body></html>");
    const result = parseJobinjaDiscoveryPage(document as unknown as Document, "https://jobinja.ir/jobs");
    expect(result.securityChallenge).toBe(true);
    expect(result.bulkApplyAvailable).toBe(true);
  });

  it("converts relative day, week, and month labels", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    expect(postedAtFromJobinja("امروز", now)).toBe("2026-08-11T00:00:00.000Z");
    expect(postedAtFromJobinja("۲ هفته پیش", now)).toBe("2026-07-28T00:00:00.000Z");
    expect(postedAtFromJobinja("۱ ماه پیش", now)).toBe("2026-07-12T00:00:00.000Z");
  });
});
