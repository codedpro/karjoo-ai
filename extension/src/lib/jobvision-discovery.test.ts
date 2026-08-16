import { describe, expect, it, vi } from "vitest";

import { discoverJobvisionListings, mapJobvisionListing } from "@ext/lib/jobvision-discovery";

function row(id: number, date: string, workType = "Full Time") {
  return {
    id,
    title: `Job ${id}`,
    company: { nameFa: "Company" },
    location: { city: { titleFa: "Tehran" } },
    workType: { titleEn: workType, titleFa: workType === "Part Time" ? "پاره وقت" : "تمام وقت" },
    salary: { titleFa: "توافقی" },
    gender: { titleFa: "مهم نیست" },
    properties: { isRemote: true },
    userJobPostInfo: { isApplied: false, isCanceledApply: false },
    firstActivationTime: { date },
    expireTime: { isExpired: false },
  };
}

describe("JobVision discovery", () => {
  it("normalizes public list rows without auth material", () => {
    const listing = mapJobvisionListing(row(123, "2026-08-15T12:00:00Z"));
    expect(listing).toMatchObject({
      externalId: "123",
      title: "Job 123",
      url: "https://jobvision.ir/jobs/123",
      alreadyApplied: false,
    });
    expect(JSON.stringify(listing)).not.toMatch(/token|authorization|cookie/i);
  });

  it("keeps only fresh selected employment types and deduplicates categories", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { jobCategoryUrlTitle: string };
      return new Response(JSON.stringify({
        data: {
          jobPostCount: 3,
          jobPosts: [
            row(1, "2026-08-15T12:00:00Z", "Full Time"),
            row(2, "2026-08-14T12:00:00Z", "Part Time"),
            row(body.jobCategoryUrlTitle === "developer" ? 3 : 1, "2026-05-01T12:00:00Z", "Full Time"),
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await discoverJobvisionListings({
      categoryKeys: ["developer", "data-science"],
      employmentTypeKeys: ["full-time"],
      remoteOnly: true,
      maxAgeDays: 45,
    }, fetchMock as unknown as typeof fetch);
    expect(result.map((item) => item.externalId)).toEqual(["1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
