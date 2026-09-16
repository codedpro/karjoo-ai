import { describe, expect, it } from "vitest";

import {
  classifyJobinjaVerification,
  jobinjaJobId,
} from "@/lib/apply/boards/jobinja-verification";

const windowStart = new Date("2026-07-22T00:00:00Z");
const recent = new Date("2026-09-05T08:00:00Z");

describe("Jobinja verification decisions", () => {
  it("matches by exact normalized job id, not the application id or title", () => {
    const evidence = { url: "https://jobinja.ir/companies/ravand-ai/jobs/TJQS" };
    expect(classifyJobinjaVerification({
      listingUrl: "https://jobinja.ir/companies/ravand-ai/jobs/tjqs/qa-engineer",
      createdAt: recent,
      updatedAt: recent,
      reason: "jobinja_submission_unconfirmed",
      history: [evidence],
      completeWindow: false,
      windowStart,
    })).toEqual({ action: "confirmed", jobId: "tjqs", evidence });
  });

  it("makes a recent missing job retryable only after a complete history scan", () => {
    const base = {
      listingUrl: "https://jobinja.ir/companies/ravand-ai/jobs/tjqs/qa-engineer",
      createdAt: recent,
      updatedAt: recent,
      reason: "jobinja_submission_unconfirmed",
      history: [],
      windowStart,
    };
    expect(classifyJobinjaVerification({ ...base, completeWindow: false }).action).toBe("unresolved");
    expect(classifyJobinjaVerification({ ...base, completeWindow: true }).action).toBe("retryable");
  });

  it("never retries an attempt older than the provider-read window", () => {
    expect(classifyJobinjaVerification({
      listingUrl: "https://jobinja.ir/companies/acme/jobs/old1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-09-03T00:00:00Z"),
      reason: "jobinja_submission_unconfirmed: corrected historical submitted-without-proof record",
      history: [],
      completeWindow: true,
      windowStart,
    }).action).toBe("unresolved");
  });

  it("rejects non-Jobinja URLs", () => {
    expect(jobinjaJobId("https://example.com/companies/x/jobs/tjqs")).toBeNull();
  });
});
