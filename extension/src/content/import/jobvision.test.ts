/**
 * JobVision import-mapper tests against an HTML fixture (linkedom). Scaffold-level
 * selectors; proves field extraction + the DATA-only (no-credentials) property.
 */
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { scrapeJobvisionProfile } from "@ext/content/import/jobvision";
import { buildImportPayload } from "@ext/lib/import-payload";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

const FIXTURE = `
  <div class="resume-header">
    <div class="full-name">مریم احمدی</div>
    <div class="job-title">طراح محصول</div>
    <div class="location">اصفهان</div>
  </div>
  <div class="about-me">درباره‌ی من به‌عنوان طراح محصول.</div>
  <div class="total-experience">۳ سال</div>
  <div class="skills">
    <span class="skill-chip">Figma</span>
    <span class="skill-chip">UX</span>
  </div>
  <div class="education"><div class="education-item">
    <span class="degree">کارشناسی ارشد</span>
    <span class="university">دانشگاه اصفهان</span>
  </div></div>
  <div class="work-experience"><div class="experience-item">
    <span class="position">طراح ارشد</span>
    <span class="company-name">شرکت ج</span>
  </div></div>
  <input type="hidden" name="access_token" value="SECRET" />
`;

describe("scrapeJobvisionProfile", () => {
  it("extracts core fields, skills, education and experience", () => {
    const p = scrapeJobvisionProfile(doc(FIXTURE));
    expect(p.fullName).toBe("مریم احمدی");
    expect(p.headline).toBe("طراح محصول");
    expect(p.city).toBe("اصفهان");
    expect(p.yearsExperience).toBe(3);
    expect(p.skills).toEqual(["Figma", "UX"]);
    expect(p.education?.[0]).toMatchObject({ degree: "کارشناسی ارشد" });
    expect(p.experience?.[0]).toMatchObject({ title: "طراح ارشد", company: "شرکت ج" });
  });

  it("returns empty for an unrelated page", () => {
    expect(Object.keys(scrapeJobvisionProfile(doc(`<div>x</div>`)))).toHaveLength(0);
  });

  it("§10: scraped DATA carries no credential despite a hidden token input", () => {
    const p = scrapeJobvisionProfile(doc(FIXTURE));
    expect(JSON.stringify(p).toLowerCase()).not.toContain("secret");
    expect(() => buildImportPayload("jobvision", p)).not.toThrow();
  });
});
