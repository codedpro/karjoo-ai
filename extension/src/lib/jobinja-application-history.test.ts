import { beforeEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";

import {
  jobIdsFromAppliedHistory,
  jobinjaJobId,
  syncJobinjaApplicationHistory,
  verifyJobinjaApplicationHistory,
} from "@ext/lib/jobinja-application-history";

beforeEach(() => {
  const { window } = parseHTML("<html></html>");
  Object.assign(globalThis, { DOMParser: window.DOMParser });
});

describe("Jobinja application history verification", () => {
  it("normalizes the provider job id from short and long URLs", () => {
    expect(jobinjaJobId("https://jobinja.ir/companies/acme/jobs/TjQs/title")).toBe("tjqs");
    expect(jobinjaJobId("https://example.com/jobs/TjQs")).toBeNull();
  });

  it("reads job ids from Jobinja's escaped init-state attribute", () => {
    const state = JSON.stringify({
      applications: { data: [{ job_link: "https://jobinja.ir/companies/ravand-ai/jobs/tjqs" }] },
    }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const html = `<div init-state="${state}"></div>`;
    expect([...jobIdsFromAppliedHistory(html)]).toEqual(["tjqs"]);
  });

  it("returns allowlisted proof only when the exact job id is in authenticated history", async () => {
    const state = JSON.stringify({
      applications: { data: [{ job_link: "https://jobinja.ir/companies/ravand-ai/jobs/tjqs" }] },
    }).replace(/"/g, "&quot;");
    const response = new Response(`<div init-state="${state}"></div>`, { status: 200 });
    Object.defineProperty(response, "url", { value: "https://jobinja.ir/jobs/applied" });
    const proof = await verifyJobinjaApplicationHistory(
      "https://jobinja.ir/companies/ravand-ai/jobs/tjqs/title",
      async () => response,
    );
    expect(proof).toMatchObject({ provider: "jobinja", signal: "application_history", jobId: "tjqs" });
  });

  it("does not use a title or an absent job as proof", async () => {
    const state = JSON.stringify({
      applications: { data: [{ job_link: "https://jobinja.ir/companies/other/jobs/xxxx" }] },
    }).replace(/"/g, "&quot;");
    const response = new Response(`<div init-state="${state}"></div>`, { status: 200 });
    Object.defineProperty(response, "url", { value: "https://jobinja.ir/jobs/applied" });
    await expect(verifyJobinjaApplicationHistory(
      "https://jobinja.ir/companies/ravand-ai/jobs/tjqs/qa-engineer",
      async () => response,
    )).resolves.toBeNull();
  });

  it("syncs pages only until the 45-day boundary and excludes older rows", async () => {
    const pages = [
      { current_page: 1, last_page: 8, data: [{ short_id: "new", created_at: "۱۰ شهریور ۱۴۰۵", job_link: "https://jobinja.ir/x/jobs/new" }] },
      { current_page: 2, last_page: 8, data: [{ short_id: "old", created_at: "۲۰ تیر ۱۴۰۵", job_link: "https://jobinja.ir/x/jobs/old" }] },
    ];
    let calls = 0;
    const result = await syncJobinjaApplicationHistory(async () => {
      const state = JSON.stringify({ applications: pages[calls++] }).replace(/"/g, "&quot;");
      const response = new Response(`<div init-state="${state}"></div>`, { status: 200 });
      Object.defineProperty(response, "url", { value: "https://jobinja.ir/jobs/applied" });
      return response;
    }, new Date("2026-09-05T12:00:00Z"));

    expect(calls).toBe(2);
    expect(result).toEqual({
      applications: [expect.objectContaining({ externalId: "new" })],
      complete: true,
    });
  });

  it("does not claim a complete history when a later page fails", async () => {
    let calls = 0;
    const result = await syncJobinjaApplicationHistory(async () => {
      calls += 1;
      if (calls === 2) throw new Error("network down");
      const state = JSON.stringify({
        applications: { current_page: 1, last_page: 3, data: [{ short_id: "one" }] },
      }).replace(/"/g, "&quot;");
      const response = new Response(`<div init-state="${state}"></div>`, { status: 200 });
      Object.defineProperty(response, "url", { value: "https://jobinja.ir/jobs/applied" });
      return response;
    });

    expect(result.complete).toBe(false);
    expect(result.applications).toHaveLength(1);
  });
});
