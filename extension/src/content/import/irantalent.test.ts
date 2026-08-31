/**
 * IranTalent import-mapper tests against an HTML fixture (linkedom). Scaffold-
 * level selectors; proves field extraction and the DATA-only rule (§10). Login
 * detection now lives in the background (lib/irantalent-session.ts).
 */
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { scrapeIrantalentProfile } from "@ext/content/import/irantalent";
import { buildImportPayload } from "@ext/lib/import-payload";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

const FIXTURE = `
  <div class="profile-summary__name">سارا کریمی</div>
  <div class="profile-summary__title">مدیر بازاریابی</div>
  <div class="profile-summary__location">تبریز</div>
  <div class="profile-about__text">خلاصه‌ای درباره‌ی بازاریابی دیجیتال.</div>
  <div class="experience-years">۶ سال</div>
  <ul class="skills">
    <li>SEO</li>
    <li>Google Ads</li>
  </ul>
  <div class="experience-section"><div class="experience-item">
    <span class="position">مدیر کمپین</span>
    <span class="company-name">شرکت ه</span>
  </div></div>
`;

describe("scrapeIrantalentProfile", () => {
  it("extracts core fields, years, skills and experience", () => {
    const p = scrapeIrantalentProfile(doc(FIXTURE));
    expect(p.fullName).toBe("سارا کریمی");
    expect(p.headline).toBe("مدیر بازاریابی");
    expect(p.city).toBe("تبریز");
    expect(p.yearsExperience).toBe(6);
    expect(p.skills).toEqual(["SEO", "Google Ads"]);
    expect(p.experience?.[0]).toMatchObject({ title: "مدیر کمپین", company: "شرکت ه" });
  });

  it("returns empty for an unrelated page", () => {
    expect(Object.keys(scrapeIrantalentProfile(doc(`<div>x</div>`)))).toHaveLength(0);
  });

  it("§10: scraped DATA carries no credential", () => {
    const p = scrapeIrantalentProfile(doc(FIXTURE));
    expect(() => buildImportPayload("irantalent", p)).not.toThrow();
  });
});
