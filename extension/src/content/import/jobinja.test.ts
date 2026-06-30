/**
 * Jobinja import-mapper tests: the pure scraper maps a résumé-page HTML fixture
 * to ScrapedProfile DATA. Also proves the scraper extracts DATA ONLY — even when
 * the page DOM contains hidden token/cookie elements, they never enter the result
 * (and would be rejected by the payload builder regardless).
 */
import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { scrapeJobinjaProfile } from "@ext/content/import/jobinja";
import { toScrapeResult } from "@ext/content/import/dom-utils";
import { buildImportPayload } from "@ext/lib/import-payload";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
}

const RESUME_FIXTURE = `
  <div class="c-resumeHeader__name">علی رضایی</div>
  <div class="c-resumeHeader__jobTitle">توسعه‌دهنده بک‌اند</div>
  <div class="c-resumeHeader__location">تهران</div>
  <div class="c-resumeHeader__experience">۵ سال سابقه</div>
  <div class="c-resumeSummary__text">خلاصه‌ی حرفه‌ای من درباره‌ی بک‌اند.</div>
  <ul>
    <li class="c-resumeSkills__item">Node.js</li>
    <li class="c-resumeSkills__item">PostgreSQL</li>
    <li class="c-resumeSkills__item">node.js</li>
  </ul>
  <div class="c-resumeEducation__item">
    <span class="degree">کارشناسی</span>
    <span class="field">مهندسی کامپیوتر</span>
    <span class="institution">دانشگاه تهران</span>
    <time class="year">۱۳۹۵</time>
  </div>
  <div class="c-resumeExperience__item">
    <span class="job-title">برنامه‌نویس</span>
    <span class="company">شرکت الف</span>
    <span class="duration">۲ سال</span>
  </div>
  <!-- A hidden credential-shaped element that MUST NOT enter the scraped DATA -->
  <input type="hidden" name="csrf-token" value="SECRET-CSRF" />
  <script id="auth_token">eyJhbG.SECRET.JWT</script>
`;

describe("scrapeJobinjaProfile", () => {
  it("extracts the core profile fields", () => {
    const p = scrapeJobinjaProfile(doc(RESUME_FIXTURE));
    expect(p.fullName).toBe("علی رضایی");
    expect(p.headline).toBe("توسعه‌دهنده بک‌اند");
    expect(p.city).toBe("تهران");
    expect(p.yearsExperience).toBe(5);
    expect(p.resumeText).toContain("خلاصه");
  });

  it("extracts deduped skills", () => {
    const p = scrapeJobinjaProfile(doc(RESUME_FIXTURE));
    expect(p.skills).toEqual(["Node.js", "PostgreSQL"]);
  });

  it("extracts education and experience entries", () => {
    const p = scrapeJobinjaProfile(doc(RESUME_FIXTURE));
    expect(p.education?.[0]).toMatchObject({
      degree: "کارشناسی",
      field: "مهندسی کامپیوتر",
      institution: "دانشگاه تهران",
    });
    expect(p.experience?.[0]).toMatchObject({ title: "برنامه‌نویس", company: "شرکت الف" });
  });

  it("parses the user's own application history", () => {
    const html = `
      <table class="applications"><tbody>
        <tr>
          <td class="title">بک‌اند ارشد</td>
          <td class="company">شرکت ب</td>
          <td class="status">در حال بررسی</td>
          <td class="date">۱۴۰۳/۰۱/۰۱</td>
          <a href="/jobs/123">لینک</a>
        </tr>
      </tbody></table>`;
    const p = scrapeJobinjaProfile(doc(html));
    expect(p.applications?.[0]).toMatchObject({
      title: "بک‌اند ارشد",
      company: "شرکت ب",
      status: "در حال بررسی",
      url: "/jobs/123",
    });
  });

  it("returns an empty object when no résumé fields are present", () => {
    const p = scrapeJobinjaProfile(doc(`<div class="unrelated">hi</div>`));
    expect(Object.keys(p)).toHaveLength(0);
    expect(toScrapeResult(p).ok).toBe(false);
  });

  it("§10: scraped DATA contains NO credential, even with hidden token/cookie DOM", () => {
    const p = scrapeJobinjaProfile(doc(RESUME_FIXTURE));
    const serialized = JSON.stringify(p).toLowerCase();
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("jwt");
    expect(serialized).not.toContain("csrf");
    // And the whole-body chokepoint accepts the clean DATA (would throw on a leak).
    expect(() => buildImportPayload("jobinja", p)).not.toThrow();
  });
});
