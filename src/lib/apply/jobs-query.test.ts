import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { parseJobsQuery, unifiedListingWhere } from "@/lib/apply/jobs-query";
import { parseUnifiedJobFilters } from "@/lib/apply/job-filter-options";

describe("parseJobsQuery", () => {
  it("defaults the public job board to all jobs, not only un-applied jobs", () => {
    expect(parseJobsQuery({}).applied).toBe("all");
    expect(parseJobsQuery({ applied: "not_applied" }).applied).toBe("not_applied");
    expect(parseJobsQuery({ applied: "applied" }).applied).toBe("applied");
  });
});

describe("unifiedListingWhere", () => {
  const render = (parts: ReturnType<typeof unifiedListingWhere>) =>
    new PgDialect().sqlToQuery(sql.join(parts, sql` and `));

  it("job lists: fresh listings on the active sites only", () => {
    const { sql: text, params } = render(unifiedListingWhere(parseUnifiedJobFilters({})));
    expect(text).toContain("l.posted_at >=");
    expect(text).toContain("l.board::text in");
    expect(params).toEqual(expect.arrayContaining(["jobinja", "jobvision", "e-estekhdam", "irantalent", "karboom"]));
  });

  it("the archive keeps its whole history under the same filters", () => {
    const filters = parseUnifiedJobFilters({ category: "legal", remote: "1" });
    const { sql: text, params } = render(unifiedListingWhere(filters, "job_listings", { history: true }));
    expect(text).not.toContain("posted_at");
    expect(text).toContain("job_listings.category =");
    expect(text).toContain("job_listings.is_remote");
    expect(params).toContain("legal");
  });

  it("applies every unified filter", () => {
    const filters = parseUnifiedJobFilters({
      q: "react",
      board: "jobvision",
      category: "software-development",
      city: "تهران",
      type: "full_time",
      posted: "1",
    });
    const { sql: text, params } = render(unifiedListingWhere(filters));
    for (const column of ["l.board =", "l.category =", "l.employment_type =", "l.city_norm ilike", "l.title ilike"]) {
      expect(text).toContain(column);
    }
    expect(params).toEqual(expect.arrayContaining(["jobvision", "software-development", "full_time", "تهران%", "%react%"]));
  });
});
