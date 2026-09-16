import { describe, expect, it } from "vitest";

import { parseJobsQuery } from "@/lib/apply/jobs-query";

describe("parseJobsQuery", () => {
  it("defaults the public job board to all jobs, not only un-applied jobs", () => {
    expect(parseJobsQuery({}).applied).toBe("all");
    expect(parseJobsQuery({ applied: "not_applied" }).applied).toBe("not_applied");
    expect(parseJobsQuery({ applied: "applied" }).applied).toBe("applied");
  });
});
