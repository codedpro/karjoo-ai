import { describe, expect, it } from "vitest";

import { normalizeProviderSnapshot } from "@/components/dashboard/provider-profile-data";

describe("provider profile snapshots", () => {
  it("normalizes provider-specific aliases and bounded skills", () => {
    const fetchedAt = new Date("2026-09-01T08:00:00Z");
    const snapshot = normalizeProviderSnapshot({
      data: {
        full_name: "امیر نوری",
        jobTitle: "Software Engineer",
        location: "بابل",
        yearsExperience: "8",
        skills: ["React", { name: "Python" }, "react"],
        workExperience: [{ company: "CodeNest" }],
      },
      publicUrl: "https://example.test/profile",
      fetchedAt,
    });

    expect(snapshot).toMatchObject({
      fullName: "امیر نوری",
      headline: "Software Engineer",
      city: "بابل",
      yearsExperience: 8,
      skills: ["React", "Python"],
      experienceCount: 1,
      fetchedAt,
    });
  });

  it("returns null when a provider has not synchronized", () => {
    expect(normalizeProviderSnapshot(undefined)).toBeNull();
  });
});
