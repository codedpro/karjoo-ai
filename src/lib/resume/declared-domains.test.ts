/**
 * حوزه‌های اعلامیِ کاربر — راهِ عملیِ «من در این زمینه کار کرده‌ام» بدونِ تایپِ هزار مهارت.
 *
 * ادعای اصلی: اعلامِ حوزه، واژگانِ همان حوزه را باز می‌کند و **نه بیشتر**. یعنی هنوز
 * نمی‌شود رزومه را به حوزه‌ای برد که کاربر اعلامش نکرده.
 */
import { describe, expect, it } from "vitest";

import { SKILL_DOMAINS, labelsForDomains, vocabularyForDomains } from "@/lib/resume/declared-domains";
import { __testables } from "@/lib/resume/custom-resume-service";

const { keepOnlyRealSkills } = __testables;

/** شاهدِ پایه: رزومه‌ای که فقط وب/فول‌استک دارد. */
const BASE = "مهارت‌ها: React، Node.js، TypeScript، PostgreSQL";

describe("vocabularyForDomains", () => {
  it("اعلامِ وب‌۳ واژگانِ همان حوزه را باز می‌کند", () => {
    const v = vocabularyForDomains(["web3"]);
    expect(v).toContain("Solidity");
    expect(v).toContain("Smart Contracts");
    expect(v).toContain("ethers.js");
  });

  it("حوزه‌ی ناشناخته چیزی اضافه نمی‌کند", () => {
    expect(vocabularyForDomains(["not-a-domain"])).toBe("");
  });

  it("برچسبِ فارسیِ حوزه‌ها را برمی‌گرداند", () => {
    expect(labelsForDomains(["web3", "mobile"])).toEqual(["وب‌۳ و بلاک‌چین", "موبایل"]);
  });

  it("هر حوزه واژگانِ غیرِخالی دارد", () => {
    for (const d of SKILL_DOMAINS) expect(d.skills.length).toBeGreaterThan(3);
  });
});

describe("گارد با حوزه‌های اعلامی", () => {
  it("مهارتِ درونِ حوزه‌ی اعلام‌شده پذیرفته می‌شود (Supabase وقتی BaaS اعلام شده)", () => {
    const evidence = `${BASE}\n${vocabularyForDomains(["baas-cloud"])}`;
    expect(keepOnlyRealSkills(["Supabase", "React"], evidence)).toEqual(["Supabase", "React"]);
  });

  it("همان مهارت بدونِ اعلامِ حوزه حذف می‌شود", () => {
    expect(keepOnlyRealSkills(["Supabase"], BASE)).toEqual([]);
  });

  it("اعلامِ یک حوزه، حوزه‌های دیگر را باز نمی‌کند", () => {
    // کاربر فقط وب‌۳ اعلام کرده → Solidity آری، ولی Sales نه.
    const evidence = `${BASE}\n${vocabularyForDomains(["web3"])}`;
    expect(keepOnlyRealSkills(["Solidity"], evidence)).toEqual(["Solidity"]);
    expect(keepOnlyRealSkills(["B2B Sales"], evidence)).toEqual([]);
  });

  it("اعلامِ فروش، رزومه‌ی فروش را ممکن می‌کند (وقتی کاربر واقعاً اعلامش کرده)", () => {
    const evidence = `${BASE}\n${vocabularyForDomains(["sales-bizdev"])}`;
    expect(keepOnlyRealSkills(["B2B Sales", "CRM", "Negotiation"], evidence)).toEqual([
      "B2B Sales",
      "CRM",
      "Negotiation",
    ]);
  });
});
