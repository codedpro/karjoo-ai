/**
 * پخشِ تکنولوژی‌های آگهی رویِ سوابقِ واقعی.
 *
 * دو ادعای اصلی: (۱) هیچ تکنولوژی‌ای به دورانی نمی‌رود که هنوز وجود نداشته، و
 * (۲) فهرست بینِ شرکت‌ها پخش می‌شود، نه این‌که همه در تازه‌ترین سابقه تلنبار شود.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_TECH_PER_ROLE,
  describeArc,
  extractYear,
  planCareerArc,
  type RoleInput,
} from "@/lib/resume/career-arc";
import { firstAvailableYear, techFitsPeriod } from "@/lib/resume/tech-timeline";

/** سوابقِ واقعیِ نمونه — قدیم تا جدید. */
const ROLES: RoleInput[] = [
  { company: "IPEC", title: "Senior Developer / Tech Lead", startDate: "Jan 2020", endDate: "Apr 2022" },
  { company: "EZOPS", title: "Full-Stack & AI Engineer", startDate: "May 2022", endDate: "Aug 2023" },
  { company: "CCTV Line", title: "Full-Stack & AI Engineer", startDate: "Mar 2024", current: true },
];

describe("extractYear", () => {
  it("سال را از رشته‌های آزاد بیرون می‌کشد", () => {
    expect(extractYear("Mar 2024")).toBe(2024);
    expect(extractYear("2018")).toBe(2018);
    expect(extractYear("Present")).toBeNull();
    expect(extractYear(null)).toBeNull();
  });
});

describe("tech-timeline", () => {
  it("سالِ پیدایشِ ابزارهای پرریسک را می‌داند", () => {
    expect(firstAvailableYear("Claude Code")).toBe(2025);
    expect(firstAvailableYear("Supabase")).toBe(2020);
    expect(firstAvailableYear("React")).toBe(2013);
  });

  it("تکنولوژیِ ناشناخته مجاز می‌ماند (fail-open)", () => {
    expect(firstAvailableYear("SomeInternalTool")).toBeNull();
    expect(techFitsPeriod("SomeInternalTool", { startYear: 1999, endYear: 2001 })).toBe(true);
  });

  it("سابقه‌ی جاری همه‌ی تکنولوژی‌های امروزی را می‌پذیرد", () => {
    expect(techFitsPeriod("Claude Code", { startYear: 2024, endYear: null })).toBe(true);
  });

  it("سابقه‌ی تمام‌شده تکنولوژیِ بعد از خودش را نمی‌پذیرد", () => {
    expect(techFitsPeriod("Claude Code", { startYear: 2013, endYear: 2015 })).toBe(false);
    expect(techFitsPeriod("Supabase", { startYear: 2013, endYear: 2015 })).toBe(false);
    expect(techFitsPeriod("React", { startYear: 2013, endYear: 2015 })).toBe(true);
  });

  it("نگارشِ متفاوت را می‌شناسد", () => {
    expect(firstAvailableYear("next.js")).toBe(2016);
    expect(firstAvailableYear("Next JS")).toBe(2016);
    expect(firstAvailableYear("ethers.js")).toBe(2016);
  });
});

describe("planCareerArc", () => {
  it("تکنولوژیِ امروزی به سابقه‌ی قدیمی نمی‌چسبد", () => {
    const arc = planCareerArc(ROLES, ["Claude Code"]);
    const ipec = arc.roles.find((r) => r.company === "IPEC")!;
    const cctv = arc.roles.find((r) => r.company === "CCTV Line")!;
    expect(ipec.technologies).not.toContain("Claude Code");
    expect(cctv.technologies).toContain("Claude Code");
  });

  it("Supabase به سابقه‌ی پیش از ۲۰۲۰ نمی‌رود", () => {
    const arc = planCareerArc(
      [{ company: "قدیمی", title: "Dev", startDate: "2013", endDate: "2016" }],
      ["Supabase"],
    );
    expect(arc.roles[0]!.technologies).toEqual([]);
    expect(arc.unplaced).toEqual(["Supabase"]);
  });

  it("فهرستِ بلند بینِ شرکت‌ها پخش می‌شود، نه در یکی تلنبار", () => {
    const techs = ["React", "Node.js", "PostgreSQL", "Docker", "Git", "Python", "REST APIs", "Linux"];
    const arc = planCareerArc(ROLES, techs);
    const loads = arc.roles.map((r) => r.technologies.length);
    expect(Math.max(...loads)).toBeLessThanOrEqual(MAX_TECH_PER_ROLE);
    // همه جای‌گذاری شدند (همه از قبل از ۲۰۲۰ موجودند).
    expect(arc.roles.flatMap((r) => r.technologies).sort()).toEqual([...techs].sort());
    expect(arc.unplaced).toEqual([]);
  });

  it("هیچ تکنولوژی‌ای دوبار جای‌گذاری نمی‌شود", () => {
    const arc = planCareerArc(ROLES, ["React", "Docker", "Supabase"]);
    const all = arc.roles.flatMap((r) => r.technologies);
    expect(new Set(all).size).toBe(all.length);
  });

  it("شرکت/عنوان/بازه دست‌نخورده از پروفایل می‌آید", () => {
    const arc = planCareerArc(ROLES, []);
    const ipec = arc.roles.find((r) => r.company === "IPEC")!;
    expect(ipec.title).toBe("Senior Developer / Tech Lead");
    expect(ipec.period).toBe("Jan 2020 – Apr 2022");
    const cctv = arc.roles.find((r) => r.company === "CCTV Line")!;
    expect(cctv.period).toBe("Mar 2024 – Present");
  });

  it("بدونِ سابقه، همه‌ی تکنولوژی‌ها بی‌جا می‌مانند (نه خطا)", () => {
    const arc = planCareerArc([], ["React"]);
    expect(arc.roles).toEqual([]);
    expect(arc.unplaced).toEqual(["React"]);
  });

  it("describeArc هر سابقه را با تکنولوژی‌های خودش می‌نویسد", () => {
    const text = describeArc(planCareerArc(ROLES, ["Claude Code", "React"]));
    expect(text).toContain("CCTV Line");
    expect(text).toContain("Claude Code");
    expect(text.split("\n")).toHaveLength(3);
  });
});
