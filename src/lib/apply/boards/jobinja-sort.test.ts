/**
 * Jobinja's sort parameter is `sort_by`, not `sort`.
 *
 * `sort` is accepted and silently ignored — the response is identical to sending
 * no sort at all. That is worse than a cosmetic ordering bug: discovery stops
 * paginating as soon as a page contains a listing older than the age cutoff, so
 * an unsorted first page ended discovery after ONE page. On a live account that
 * left 13 of the 20 newest remote software jobs undiscovered.
 */
import { describe, expect, it } from "vitest";

import { buildSearchUrl } from "@/lib/apply/boards/jobinja";

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("buildSearchUrl sorting", () => {
  it("uses sort_by, the only name Jobinja honours", () => {
    const p = params(buildSearchUrl({ categorySlugs: ["iT--DevOps--Server"] }, 1));
    expect(p.get("sort_by")).toBe("published_at_desc");
    expect(p.has("sort")).toBe(false);
  });

  it("defaults to newest-first, which is what makes the age cutoff meaningful", () => {
    expect(params(buildSearchUrl({}, 1)).get("sort_by")).toBe("published_at_desc");
  });

  it("passes the user's chosen ordering through", () => {
    const p = params(buildSearchUrl({ sort: "salary_from_desc" }, 1));
    expect(p.get("sort_by")).toBe("salary_from_desc");
  });

  it("still carries category, remote and paging alongside it", () => {
    const p = params(
      buildSearchUrl({ categorySlugs: ["iT--DevOps--Server"], remoteOnly: true }, 3),
    );
    expect(p.getAll("filters[job_categories][]")).toContain("iT--DevOps--Server");
    expect(p.get("filters[remote]")).toBe("1");
    expect(p.get("page")).toBe("3");
  });
});
