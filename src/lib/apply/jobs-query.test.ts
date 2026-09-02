import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOB_PAGE_SIZE,
  MAX_JOB_PAGE_SIZE,
  parseJobsQuery,
} from "@/lib/apply/jobs-query";

describe("parseJobsQuery", () => {
  it("defaults to fresh unapplied jobs sorted newest first", () => {
    expect(parseJobsQuery({})).toEqual({
      q: null,
      board: null,
      city: null,
      status: null,
      applied: "not_applied",
      sort: "newest",
      dir: "desc",
      page: 1,
      pageSize: DEFAULT_JOB_PAGE_SIZE,
    });
  });

  it("keeps valid filters and clamps pagination", () => {
    const parsed = parseJobsQuery({
      q: " react ",
      board: "jobinja",
      city: " تهران ",
      status: "queued",
      applied: "all",
      sort: "score",
      dir: "asc",
      page: "3",
      pageSize: "1000",
    });
    expect(parsed).toMatchObject({
      q: "react",
      board: "jobinja",
      city: "تهران",
      status: "queued",
      applied: "all",
      sort: "score",
      dir: "asc",
      page: 3,
      pageSize: MAX_JOB_PAGE_SIZE,
    });
  });

  it("drops unknown enum-like values fail-closed", () => {
    const parsed = parseJobsQuery({
      board: "bogus",
      status: "submitted",
      applied: "sideways",
      sort: "url",
      dir: "sideways",
      page: "-2",
      pageSize: "1",
    });
    expect(parsed.board).toBeNull();
    expect(parsed.status).toBeNull();
    expect(parsed.applied).toBe("not_applied");
    expect(parsed.sort).toBe("newest");
    expect(parsed.dir).toBe("desc");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(5);
  });

  it("trims long text fields to bounded search values", () => {
    expect(parseJobsQuery({ q: "x".repeat(500) }).q).toHaveLength(80);
    expect(parseJobsQuery({ city: "y".repeat(500) }).city).toHaveLength(80);
    expect(parseJobsQuery({ q: "   ", city: "   " }).q).toBeNull();
    expect(parseJobsQuery({ q: "   ", city: "   " }).city).toBeNull();
  });
});
