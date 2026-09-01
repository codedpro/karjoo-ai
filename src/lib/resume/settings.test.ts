import { describe, expect, it } from "vitest";

import { parseResumeSettings, resumeSettingsPatch } from "@/lib/resume/settings";

describe("resume settings", () => {
  it("normalizes the account-specific settings used by resume generation", () => {
    const settings = parseResumeSettings({
      gender: "male",
      fullNameLatin: " Amir Nouri ",
      resumeLang: "en",
      resumeTemplate: "signature",
      declaredDomains: ["web-fullstack", "unknown", "web-fullstack"],
      broadMatchingSections: ["software", "invalid"],
      clients: [{ name: "CCTV Line" }, "CodeNest", { name: "CCTV Line" }],
      unlimitedApply: true,
    });

    expect(settings).toMatchObject({
      gender: "male",
      fullNameLatin: "Amir Nouri",
      resumeLang: "en",
      resumeTemplate: "signature",
      declaredDomains: ["web-fullstack"],
      broadMatchingSections: ["software"],
      clients: ["CCTV Line", "CodeNest"],
      unlimitedApply: true,
    });
  });

  it("builds only the preference keys owned by the resume editor", () => {
    const patch = resumeSettingsPatch({
      ...parseResumeSettings(null),
      fullNameLatin: "",
      clients: [" CodeNest ", "CodeNest", "CCTV Line"],
    });

    expect(patch).not.toHaveProperty("boardFilters");
    expect(patch.fullNameLatin).toBeNull();
    expect(patch.clients).toEqual([{ name: "CodeNest" }, { name: "CCTV Line" }]);
  });
});
