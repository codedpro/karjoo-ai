import { describe, expect, it } from "vitest";

import type { ResumeTailorOutput } from "@/lib/ai/schema";
import { __testables } from "@/lib/resume/custom-resume-service";
import type { RoleInput } from "@/lib/resume/career-arc";
import {
  VARIABLE_COMPANY_DOMAINS,
  variableCompaniesForDomain,
} from "@/lib/resume/role-selection";

const {
  buildMarketCalibrationContext,
  fitForTwoToThreePages,
  ensurePinnedExperience,
  alignHeadlineToJobTitle,
  scrubTargetLeakage,
  scrubRestrictedTechnologyPlacement,
  rolesAllowedForRenderedExperience,
  buildVariableCompanyInstruction,
  buildGeneratedTimelineInstruction,
  withMissingFixedCompanyRoles,
  applyGeneratedTimeline,
  plannedPeriodForCompany,
  generatedTimelineRank,
  deterministicGeneratedTimeline,
  enforceGeneratedExperienceTimeline,
  mergePinnedCompanies,
} = __testables;

describe("JD-shaped positioning helpers", () => {
  it("manual mode always keeps the default pinned companies even with custom pins", () => {
    expect(mergePinnedCompanies({ pinnedCompanies: ["Egbal"] }, true)).toEqual([
      "CodeNest",
      "MTN Irancell",
      "UK Trade Line",
      "CCTV Line",
      "Egbal",
    ]);
  });

  it("manual mode adds missing fixed company slots including UK Trade Line", () => {
    const roles = withMissingFixedCompanyRoles([{ company: "CodeNest" }], "SEO Specialist");
    expect(roles.map((r) => r.company)).toEqual([
      "CodeNest",
      "MTN Irancell",
      "UK Trade Line",
      "CCTV Line",
    ]);
  });

  it("non-manual mode does not silently add the aggressive default pins", () => {
    expect(mergePinnedCompanies({ pinnedCompanies: ["Egbal"] }, false)).toEqual(["Egbal"]);
  });

  it("market calibration is explicitly not resume evidence", () => {
    const text = buildMarketCalibrationContext([
      {
        name: "HubSpot",
        field: "CRM",
        descriptor: "Customer platform for marketing, sales, and service teams.",
      },
      { name: "Salesforce", field: "CRM" },
    ]);

    expect(text).toContain("market vocabulary only");
    expect(text).toContain("هرگز");
    expect(text).toContain("HubSpot");
    expect(text).toContain("Salesforce");
  });

  it("missing pinned companies are added only from real selected roles", () => {
    const tailored: ResumeTailorOutput = {
      headline: "AI Automation Lead",
      summary: "Builds automation platforms.",
      skills: ["AI", "Dashboards"],
      experience: [
        {
          company: "CodeNest",
          title: "Founder",
          period: "2018 - Present",
          bullets: ["Built full-stack platforms."],
        },
      ],
      highlights: [],
    };
    const roles: RoleInput[] = [
      {
        company: "CodeNest",
        title: "Founder",
        startDate: "2018",
        current: true,
        description: "Independent studio shipping products.",
      },
      {
        company: "MTN Irancell",
        title: "Ops Solution Architecture Specialist",
        startDate: "Aug 2023",
        current: true,
        description: "NOC dashboards, automated reporting, and telecom KPI analysis.",
      },
      {
        company: "Not A Pinned Company",
        title: "Developer",
        startDate: "2020",
        description: "Unrelated role.",
      },
    ];

    const out = ensurePinnedExperience(tailored, roles, new Map());
    expect(out.experience.map((e) => e.company)).toEqual(["CodeNest", "MTN Irancell"]);
    expect(out.experience.map((e) => e.company)).not.toContain("Not A Pinned Company");
  });

  it("two-to-three-page fitting reduces very long prose before rendering", () => {
    const long = "Built AI workflow automation dashboards with CRM reporting and operations visibility. ".repeat(80);
    const tailored: ResumeTailorOutput = {
      headline: "AI Workflow Developer",
      summary: long,
      skills: Array.from({ length: 45 }, (_, i) => `Skill ${i}`),
      experience: Array.from({ length: 4 }, (_, i) => ({
        company: `Company ${i}`,
        title: "Very Long JD-Shaped Automation and Growth Systems Leadership Role",
        period: "2020 - Present",
        context: long,
        bullets: Array.from({ length: 8 }, () => long),
      })),
      highlights: Array.from({ length: 6 }, () => long),
    };

    const out = fitForTwoToThreePages(tailored);
    const text = [
      out.summary,
      ...out.skills,
      ...out.experience.flatMap((e) => [e.title ?? "", e.context ?? "", ...e.bullets]),
      ...(out.highlights ?? []),
    ].join(" ");

    expect(text.length).toBeLessThan(10_800);
    expect(out.skills.length).toBeLessThanOrEqual(34);
    expect(out.experience.every((e) => e.bullets.length <= 6)).toBe(true);
  });

  it("manual positioning uses the exact JD title as the headline", () => {
    const tailored: ResumeTailorOutput = {
      headline: "Full-stack Engineer & Growth Systems Builder",
      summary: "Full-stack engineer with SEO experience.",
      skills: ["SEO"],
      experience: [],
      highlights: [],
    };

    expect(alignHeadlineToJobTitle(tailored, "SEO Specialist", true).headline).toBe(
      "SEO Specialist",
    );
    expect(alignHeadlineToJobTitle(tailored, "SEO Specialist", false).headline).toBe(
      "Full-stack Engineer & Growth Systems Builder",
    );
  });

  it("scrubs target-company and JD-tailoring leakage from CV content", () => {
    const tailored: ResumeTailorOutput = {
      headline: "Technical SEO & AI Search Growth Lead",
      summary:
        "Full-stack engineer and growth systems builder. Strong fit for OriginWeb because the role needs Technical SEO and Shopify SEO. Delivers ecommerce SEO, analytics, and performance workflows.",
      skills: ["Technical SEO", "OriginWeb SEO"],
      experience: [
        {
          company: "CodeNest",
          title: "SEO Growth Specialist",
          context: "Built systems for this role needs ecommerce SEO.",
          bullets: ["Connected SEO audits to delivery for OriginWeb.", "Improved Core Web Vitals."],
        },
      ],
      highlights: ["Strong fit for OriginWeb because the role needs multilingual SEO."],
    };

    const out = scrubTargetLeakage(tailored, "OriginWeb");
    const text = [
      out.headline,
      out.summary,
      ...out.skills,
      ...out.experience.flatMap((e) => [e.title ?? "", e.context ?? "", ...e.bullets]),
      ...(out.highlights ?? []),
    ].join(" ");

    expect(text).not.toMatch(/OriginWeb/i);
    expect(text).not.toMatch(/strong fit/i);
    expect(text).not.toMatch(/this role needs/i);
    expect(out.summary).toContain("Delivers ecommerce SEO");
  });

  it("manual rendered experience is restricted to pinned employers", () => {
    const roles: RoleInput[] = [
      { company: "CodeNest", title: "SEO Specialist" },
      { company: "MTN Irancell", title: "SEO Analytics Specialist" },
      { company: "CCTV Line", title: "Ecommerce SEO Specialist" },
      { company: "UK Trade Line", title: "International SEO Specialist" },
      { company: "Buffer", title: "SEO Content Specialist" },
      { company: "Khadamateman", title: "Local SEO Specialist" },
      { company: "Egbal (Germany)", title: "Marketing Automation Specialist" },
      { company: "EZOPS / Easy Ops (Netherlands)", title: "SEO Specialist" },
    ];
    const variableCompanies = [
      { domain: "seo-digital-marketing", region: "international" as const, name: "Buffer" },
      { domain: "seo-digital-marketing", region: "iran" as const, name: "Khadamateman" },
    ];

    expect(rolesAllowedForRenderedExperience(roles, true, variableCompanies).map((r) => r.company)).toEqual(
      ["CodeNest", "MTN Irancell", "CCTV Line", "UK Trade Line", "Buffer", "Khadamateman"],
    );
    expect(rolesAllowedForRenderedExperience(roles, false).map((r) => r.company)).toContain(
      "Egbal (Germany)",
    );
  });

  it("variable company instruction names exactly the selected pair", () => {
    const text = buildVariableCompanyInstruction([
      { domain: "web-fullstack", region: "international", name: "Automattic" },
      { domain: "web-fullstack", region: "iran", name: "Niksam AI" },
    ]);

    expect(text).toContain("Automattic");
    expect(text).toContain("Niksam AI");
    expect(text).toContain("international");
    expect(text).toContain("Iran");
  });

  it("generated fixed and variable slots use the approved non-overlapping timeline", () => {
    const variables = [
      { domain: "web-fullstack", region: "international" as const, name: "Automattic" },
      { domain: "web-fullstack", region: "iran" as const, name: "Niksam AI" },
    ];
    const roles = applyGeneratedTimeline(
      [
        { company: "CodeNest", current: true },
        { company: "Niksam AI" },
        { company: "MTN Irancell", current: true },
        { company: "UK Trade Line" },
        { company: "Automattic" },
        { company: "CCTV Line (UK)", current: false },
      ],
      variables,
    );

    expect(roles.map((r) => [r.company, r.startDate, r.endDate, r.current])).toEqual([
      ["Niksam AI", "2018", "2019", false],
      ["CodeNest", "2019", "2021", false],
      ["UK Trade Line", "2021", "2022", false],
      ["CCTV Line (UK)", "2022", "2024", false],
      ["Automattic", "2024", "2025", false],
      ["MTN Irancell", "2025", null, true],
    ]);
  });

  it("generated timeline instruction makes MTN Irancell the only present role", () => {
    const text = buildGeneratedTimelineInstruction([
      { domain: "ai-ml", region: "international", name: "Hugging Face" },
      { domain: "ai-ml", region: "iran", name: "Armaghan Atlas" },
    ]);

    expect(text).toContain("Armaghan Atlas: 2018 - 2019");
    expect(text).toContain("CodeNest: 2019 - 2021");
    expect(text).toContain("UK Trade Line: 2021 - 2022");
    expect(text).toContain("CCTV Line: 2022 - 2024");
    expect(text).toContain("Hugging Face: 2024 - 2025");
    expect(text).toContain("MTN Irancell: 2025 - Present");
    expect((text.match(/- Present/g) ?? []).length).toBe(1);
  });

  it("uses the same regional slots for every variable-company domain", () => {
    for (const domain of VARIABLE_COMPANY_DOMAINS) {
      const pair = variableCompaniesForDomain(domain);
      const iran = pair.find((company) => company.region === "iran")!;
      const international = pair.find((company) => company.region === "international")!;
      const slots = deterministicGeneratedTimeline(pair);

      expect(slots.map((slot) => slot.company)).toEqual([
        iran.name,
        "CodeNest",
        "UK Trade Line",
        "CCTV Line",
        international.name,
        "MTN Irancell",
      ]);
      expect(slots.map((slot) => [slot.startDate, slot.endDate, slot.current])).toEqual([
        ["2018", "2019", false],
        ["2019", "2021", false],
        ["2021", "2022", false],
        ["2022", "2024", false],
        ["2024", "2025", false],
        ["2025", null, true],
      ]);
    }
  });

  it("normalizes rendered AI experience to the approved dates and order", () => {
    const variables = variableCompaniesForDomain("ai-ml");
    const iran = variables.find((company) => company.region === "iran")!;
    const international = variables.find((company) => company.region === "international")!;
    const experience = enforceGeneratedExperienceTimeline(
      [
        { company: "MTN Irancell", period: "2020 – Present" },
        { company: "CCTVline (UK)", period: "2017 – Present" },
        { company: international.name, period: "2018 – Present" },
        { company: "UK Trade Line", period: "2024 – Present" },
        { company: iran.name, period: "2025 – Present" },
        { company: "Code Nest", period: "2019 – Present" },
      ],
      variables,
    );

    expect(experience.map((entry) => entry.company)).toEqual([
      iran.name,
      "Code Nest",
      "UK Trade Line",
      "CCTVline (UK)",
      international.name,
      "MTN Irancell",
    ]);
    expect(experience.map((entry) => entry.period)).toEqual([
      "2018 – 2019",
      "2019 – 2021",
      "2021 – 2022",
      "2022 – 2024",
      "2024 – 2025",
      "2025 – Present",
    ]);
    expect(experience.filter((entry) => entry.period?.endsWith("Present"))).toHaveLength(1);
  });

  it("planned period lookup handles AI suffixes like '(International)'", () => {
    const periods = new Map([
      ["huggingface", "2024 - 2025"],
      ["cctvline", "2022 - 2024"],
      ["codenest", "2019 - 2021"],
    ]);

    expect(plannedPeriodForCompany(periods, "Hugging Face (International)")).toBe("2024 - 2025");
    expect(plannedPeriodForCompany(periods, "CCTVline (UK)")).toBe("2022 - 2024");
    expect(plannedPeriodForCompany(periods, "Code Nest")).toBe("2019 - 2021");
    expect(generatedTimelineRank("MTN Irancell", [])).toBeGreaterThan(
      generatedTimelineRank("CCTVline (UK)", []),
    );
  });

  it("restricted ecommerce tech is scrubbed from Iran company entries only", () => {
    const tailored: ResumeTailorOutput = {
      headline: "Web Specialist",
      summary: "Builds ecommerce systems.",
      skills: ["Shopify", "SEO"],
      experience: [
        {
          company: "MTN Irancell",
          title: "Shopify Analytics Specialist",
          context: "Used Shopify analytics for dashboards.",
          bullets: ["Built Shopify reporting."],
        },
        {
          company: "CCTV Line (UK)",
          title: "Shopify Ecommerce Specialist",
          context: "Built Shopify storefronts.",
          bullets: ["Optimized Shopify catalog pages."],
        },
      ],
      highlights: [],
    };

    const out = scrubRestrictedTechnologyPlacement(tailored);
    const mtn = out.experience.find((e) => e.company === "MTN Irancell")!;
    const cctv = out.experience.find((e) => e.company === "CCTV Line (UK)")!;
    expect([mtn.title, mtn.context, ...mtn.bullets].join(" ")).not.toMatch(/Shopify/i);
    expect([cctv.title, cctv.context, ...cctv.bullets].join(" ")).toMatch(/Shopify/i);
  });
});
