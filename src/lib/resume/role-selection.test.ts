/**
 * انتخابِ سوابق برای یک آگهیِ مشخص.
 *
 * سه ادعا: شرکت‌های سنجاق‌شده همیشه می‌مانند، بقیه بر اساسِ ربط به آگهی انتخاب می‌شوند،
 * و فقط **یک** شغل به‌عنوانِ جاری معرفی می‌شود — بدونِ ساختنِ تاریخِ پایانِ جعلی.
 */
import { describe, expect, it } from "vitest";

import type { RoleInput } from "@/lib/resume/career-arc";
import {
  canPlaceTechnologyAtCompany,
  DEFAULT_PINNED_COMPANIES,
  inferVariableCompanyDomain,
  isInternationalCompanyName,
  scoreRole,
  selectRolesForJob,
  variableCompaniesForDomain,
} from "@/lib/resume/role-selection";
import { __testables } from "@/lib/resume/custom-resume-service";

const { keepOnlyRealEmployers } = __testables;

/** سوابقِ واقعیِ نمونه — سه‌تای اول جاری‌اند. */
const ROLES: RoleInput[] = [
  {
    company: "CodeNest",
    title: "Founder & Full-Stack Engineer",
    startDate: "2018",
    current: true,
    description: "Multi-tenant SaaS, marketplace integrations, AI systems, Next.js and Python.",
  },
  {
    company: "CCTV Line (UK)",
    title: "Full-Stack & AI Engineer",
    startDate: "Mar 2024",
    current: true,
    description: "Storefront builder, AI customer-support layer, CRM, vector knowledge base.",
  },
  {
    company: "MTN Irancell",
    title: "Ops Solution Architecture & Data Analysis Specialist",
    startDate: "Aug 2023",
    current: true,
    description: "Telecom OSS platform, data analysis, dashboards, real-time monitoring.",
  },
  {
    company: "Egbal (Germany)",
    title: "Senior Developer",
    startDate: "Apr 2024",
    endDate: "Jan 2025",
    description: "React and TypeScript front-end work.",
  },
  {
    company: "IPEC",
    title: "Senior Developer / Tech Lead",
    startDate: "Jan 2020",
    endDate: "Apr 2022",
    description: "Led a team building internal .NET and SQL Server tooling.",
  },
];

describe("scoreRole", () => {
  it("هم‌پوشانیِ واژگانِ آگهی با شرحِ سابقه را می‌شمارد", () => {
    expect(scoreRole(ROLES[2]!, ["data analysis", "dashboards"])).toBe(2);
    expect(scoreRole(ROLES[2]!, ["Solidity", "NFT"])).toBe(0);
  });

  it("سابقه‌ی بی‌شرح امتیازِ صفر می‌گیرد", () => {
    expect(scoreRole({ company: "X" }, ["React"])).toBe(0);
  });
});

describe("selectRolesForJob", () => {
  it("فقط یک شغل به‌عنوانِ جاری معرفی می‌شود", () => {
    const sel = selectRolesForJob(ROLES, ["data analysis"]);
    expect(sel.filter((r) => r.current)).toHaveLength(1);
    expect(sel.filter((r) => r.isLeadCurrent)).toHaveLength(1);
  });

  it("سابقه‌ی جاریِ غیرِاصلی می‌ماند ولی تاریخِ پایانِ جعلی نمی‌گیرد", () => {
    const sel = selectRolesForJob(ROLES, ["data analysis"]);
    const demoted = sel.filter((r) => !r.isLeadCurrent && !r.endDate);
    // حذف نشده‌اند…
    expect(sel.map((r) => r.company)).toContain("CCTV Line (UK)");
    expect(sel.map((r) => r.company)).toContain("MTN Irancell");
    // …و هیچ‌کدام تاریخِ پایانِ ساختگی نگرفته‌اند.
    for (const r of demoted) expect(r.endDate ?? null).toBeNull();
  });

  it("سابقه‌ی تمام‌شده تاریخِ واقعی‌اش را نگه می‌دارد", () => {
    const sel = selectRolesForJob(ROLES, ["React"]);
    expect(sel.find((r) => r.company === "IPEC")?.endDate).toBe("Apr 2022");
  });

  it("برای آگهیِ تحلیلِ داده، مرتبط‌ترین سابقه‌ی جاری انتخاب می‌شود", () => {
    const sel = selectRolesForJob(ROLES, ["data analysis", "dashboards", "monitoring"], {
      pinned: [],
    });
    expect(sel.find((r) => r.isLeadCurrent)?.company).toBe("MTN Irancell");
  });

  it("برای آگهیِ هوش مصنوعی، سابقه‌ی AI انتخاب می‌شود", () => {
    const sel = selectRolesForJob(ROLES, ["AI", "vector", "customer-support"], { pinned: [] });
    expect(sel.find((r) => r.isLeadCurrent)?.company).toBe("CCTV Line (UK)");
  });

  it("هر سه شرکتِ سنجاق‌شده می‌مانند، حتی وقتی هر سه جاری‌اند", () => {
    const sel = selectRolesForJob(ROLES, ["Solidity", "NFT", "DeFi"]);
    const names = sel.map((r) => r.company);
    expect(names).toContain("CodeNest");
    expect(names).toContain("CCTV Line (UK)");
    expect(names).toContain("MTN Irancell");
    // ولی فقط یکی به‌عنوانِ شغلِ جاری معرفی می‌شود.
    expect(sel.filter((r) => r.current)).toHaveLength(1);
  });

  it("سابقه‌ی نامرتبط و غیرِسنجاق کنار می‌رود", () => {
    const sel = selectRolesForJob(ROLES, ["data analysis"], { maxRoles: 3 });
    expect(sel.length).toBeLessThanOrEqual(3);
  });

  it("هیچ نامِ شرکتی عوض نمی‌شود — فقط زیرمجموعه‌ای از واقعی‌ها", () => {
    const real = new Set(ROLES.map((r) => r.company));
    for (const r of selectRolesForJob(ROLES, ["anything"])) {
      expect(real.has(r.company)).toBe(true);
    }
  });

  it("ترتیبِ نمایش: شغلِ جاری اول", () => {
    const sel = selectRolesForJob(ROLES, ["React"]);
    expect(sel[0]!.isLeadCurrent).toBe(true);
    expect(sel[0]!.current).toBe(true);
  });

  it("فهرستِ خالی → آرایه‌ی خالی (نه خطا)", () => {
    expect(selectRolesForJob([], ["React"])).toEqual([]);
  });

  it("پیش‌فرضِ سنجاق‌ها همان چهار شرکتِ اعلامیِ کاربر است", () => {
    expect(DEFAULT_PINNED_COMPANIES).toEqual([
      "CodeNest",
      "MTN Irancell",
      "UK Trade Line",
      "CCTV Line",
    ]);
  });
});

describe("variable company selection", () => {
  it("برای سئو/دیجیتال مارکتینگ Buffer و Khadamateman را انتخاب می‌کند", () => {
    expect(variableCompaniesForDomain("seo-digital-marketing").map((c) => c.name)).toEqual([
      "Buffer",
      "Khadamateman",
    ]);
  });

  it("برای وب یک international و یک ایران انتخاب می‌کند", () => {
    expect(variableCompaniesForDomain("web-fullstack")).toEqual([
      { domain: "web-fullstack", region: "international", name: "Automattic" },
      { domain: "web-fullstack", region: "iran", name: "Niksam AI" },
    ]);
  });

  it("دامنه را از متن آگهی تشخیص می‌دهد", () => {
    expect(inferVariableCompanyDomain(["SEO, Ahrefs, Search Console"], [])).toBe(
      "seo-digital-marketing",
    );
    expect(inferVariableCompanyDomain(["React Next.js Shopify storefront"], [])).toBe(
      "web-fullstack",
    );
  });

  it("تکنولوژی‌های محدود ایران فقط روی شرکت‌های international مجازند", () => {
    expect(canPlaceTechnologyAtCompany("Shopify", "MTN Irancell")).toBe(false);
    expect(canPlaceTechnologyAtCompany("Shopify", "Khadamateman")).toBe(false);
    expect(canPlaceTechnologyAtCompany("Shopify", "CCTV Line (UK)")).toBe(true);
    expect(canPlaceTechnologyAtCompany("Shopify", "Automattic")).toBe(true);
    expect(canPlaceTechnologyAtCompany("PostgreSQL", "MTN Irancell")).toBe(true);
    expect(isInternationalCompanyName("UK Trade Line")).toBe(true);
  });
});

/**
 * گاردِ کارفرما — همتای گاردِ مهارت.
 *
 * تفاوت عمدی است: مهارت ادعایی درباره‌ی خودِ کاربر است و انتخابِ آگهی اعلامِ اوست؛
 * نامِ کارفرما ادعایی درباره‌ی سازمانی دیگر است که چیزی اعلام نکرده. پس این گارد
 * هیچ مسیرِ دور زدنی ندارد.
 */
describe("keepOnlyRealEmployers", () => {
  const SELECTED = [{ company: "CodeNest" }, { company: "MTN Irancell" }];

  it("شرکتِ واقعی می‌ماند", () => {
    const out = keepOnlyRealEmployers([{ company: "CodeNest" }], SELECTED);
    expect(out).toHaveLength(1);
  });

  it("شرکتی که کاربر آن‌جا کار نکرده حذف می‌شود، حتی اگر مدل نوشته باشد", () => {
    const out = keepOnlyRealEmployers(
      [{ company: "CodeNest" }, { company: "دیوار" }, { company: "اسنپ" }],
      SELECTED,
    );
    expect(out.map((e) => e.company)).toEqual(["CodeNest"]);
  });

  it("سابقه‌ی کنارگذاشته‌شده هم برنمی‌گردد", () => {
    const out = keepOnlyRealEmployers([{ company: "IPEC" }], SELECTED);
    expect(out).toEqual([]);
  });

  it("تفاوتِ نگارش مانع نمی‌شود", () => {
    const out = keepOnlyRealEmployers([{ company: "MTN  Irancell" }], SELECTED);
    expect(out).toHaveLength(1);
  });

  it("بدونِ انتخاب، فهرست دست‌نخورده می‌ماند", () => {
    const entries = [{ company: "هرچه" }];
    expect(keepOnlyRealEmployers(entries, [])).toEqual(entries);
  });
});
