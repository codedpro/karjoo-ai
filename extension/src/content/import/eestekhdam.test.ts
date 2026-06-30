/**
 * e-estekhdam import-mapper tests against an HTML fixture (linkedom). Scaffold-
 * level selectors; proves field extraction + the DATA-only (no-credentials) rule.
 */
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { scrapeEestekhdamProfile } from "@ext/content/import/eestekhdam";
import { buildImportPayload } from "@ext/lib/import-payload";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

const FIXTURE = `
  <div class="profile-header__name">حسین مرادی</div>
  <div class="profile-header__title">حسابدار</div>
  <div class="profile-header__location">شیراز</div>
  <div class="profile-about">خلاصه‌ای درباره‌ی تجربه‌ی حسابداری.</div>
  <div class="experience-years">۸ سال</div>
  <ul class="skills-list">
    <li class="skill">Excel</li>
    <li class="skill">حسابداری</li>
  </ul>
  <div class="experience-list"><div class="experience-item">
    <span class="position">حسابدار ارشد</span>
    <span class="company">شرکت د</span>
  </div></div>
  <div class="cookie-banner" data-cookie="should-be-ignored">پذیرش کوکی‌ها</div>
`;

describe("scrapeEestekhdamProfile", () => {
  it("extracts core fields, years, skills and experience", () => {
    const p = scrapeEestekhdamProfile(doc(FIXTURE));
    expect(p.fullName).toBe("حسین مرادی");
    expect(p.headline).toBe("حسابدار");
    expect(p.city).toBe("شیراز");
    expect(p.yearsExperience).toBe(8);
    expect(p.skills).toEqual(["Excel", "حسابداری"]);
    expect(p.experience?.[0]).toMatchObject({ title: "حسابدار ارشد", company: "شرکت د" });
  });

  it("returns empty for an unrelated page", () => {
    expect(Object.keys(scrapeEestekhdamProfile(doc(`<div>x</div>`)))).toHaveLength(0);
  });

  it("§10: scraped DATA carries no credential (cookie banner text/attrs excluded)", () => {
    const p = scrapeEestekhdamProfile(doc(FIXTURE));
    expect(JSON.stringify(p).toLowerCase()).not.toContain("cookie");
    expect(() => buildImportPayload("e-estekhdam", p)).not.toThrow();
  });
});
