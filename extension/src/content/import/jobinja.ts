/**
 * Jobinja profile-import content script (jobinja.ir).
 *
 * Reads the user's OWN résumé/profile page DOM (read-only) and returns structured
 * profile DATA. Jobinja is server-rendered, so the résumé page is plain HTML with
 * fairly stable, labelled sections — this is the most fleshed-out scraper; the
 * others are scaffolded with clear TODOs to verify against a real account.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10): scraping is limited to the user's OWN logged-in profile page.
 * This script ONLY reads DATA (text) from the DOM. It NEVER reads cookies /
 * localStorage / any token, never writes, never submits. The DATA it returns is
 * scanned again by the DATA-only payload builder before anything leaves the
 * browser. No bot-detection-evasion, no auto-actions.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * NOTE: selectors are best-effort and MUST be re-verified against a live Jobinja
 * résumé page (the panel HTML may change). They are intentionally generous
 * (multiple candidates) and fall back gracefully — a missing field is simply
 * omitted, never guessed.
 */
import {
  textOf,
  attrOf,
  textListOf,
  elementsOf,
  parseYears,
  splitSkills,
  compact,
  hasAnyValue,
  toScrapeResult,
} from "@ext/content/import/dom-utils";
import type { BackgroundToImportContent } from "@ext/lib/messages";
import type {
  ScrapedProfile,
  ScrapedEducation,
  ScrapedExperience,
  ScrapedApplication,
} from "@ext/lib/import-types";
import { scrapeJobinjaViaApi } from "@ext/content/import/jobinja-api";

/**
 * PURE: map a Jobinja résumé-page DOM subtree → ScrapedProfile.
 * Exported for unit testing against an HTML fixture (linkedom). No globals, no IO.
 */
export function scrapeJobinjaProfile(root: ParentNode): ScrapedProfile {
  const fullName = textOf(root, [
    "[data-test=resume-full-name]",
    ".c-resumeHeader__name",
    ".resume-header__name",
    "h1.c-resume__name",
    "h1",
  ]);

  const headline = textOf(root, [
    "[data-test=resume-job-title]",
    ".c-resumeHeader__jobTitle",
    ".resume-header__job-title",
    ".resume-header__title",
  ]);

  const city = textOf(root, [
    "[data-test=resume-city]",
    ".c-resumeHeader__location",
    ".resume-header__location",
    ".resume-header__city",
  ]);

  const resumeText = textOf(root, [
    "[data-test=resume-summary]",
    ".c-resumeSummary__text",
    ".resume-summary",
    ".resume-about",
    "section.about p",
  ]);

  const yearsExperience = parseYears(
    textOf(root, [
      "[data-test=resume-experience-years]",
      ".c-resumeHeader__experience",
      ".resume-header__experience",
    ]),
  );

  // Skills: prefer a tag list; fall back to a comma-separated blob.
  const skillNodes = textListOf(root, [
    "[data-test=resume-skill]",
    ".c-resumeSkills__item",
    ".resume-skills__item",
    ".skill-tag",
    "ul.skills li",
  ]);
  const skills =
    skillNodes.length > 0
      ? skillNodes
      : splitSkills(textOf(root, ["[data-test=resume-skills]", ".resume-skills", ".skills"]));

  const education = scrapeEducation(root);
  const experience = scrapeExperience(root);
  const applications = scrapeApplications(root);

  return compact({
    fullName,
    headline,
    city,
    resumeText,
    yearsExperience,
    skills,
    education,
    experience,
    applications,
  }) as ScrapedProfile;
}

function scrapeEducation(root: ParentNode): ScrapedEducation[] | undefined {
  const items = elementsOf(root, [
    "[data-test=resume-education-item]",
    ".c-resumeEducation__item",
    ".resume-education__item",
    "section.education .item",
  ]);
  const out: ScrapedEducation[] = [];
  for (const item of items) {
    const entry = compact<ScrapedEducation>({
      degree: textOf(item, ["[data-test=education-degree]", ".degree", ".education__degree"]),
      field: textOf(item, ["[data-test=education-field]", ".field", ".education__field"]),
      institution: textOf(item, [
        "[data-test=education-institution]",
        ".institution",
        ".education__institution",
        ".university",
      ]),
      year: textOf(item, ["[data-test=education-year]", ".year", ".education__year", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

function scrapeExperience(root: ParentNode): ScrapedExperience[] | undefined {
  const items = elementsOf(root, [
    "[data-test=resume-experience-item]",
    ".c-resumeExperience__item",
    ".resume-experience__item",
    "section.experience .item",
  ]);
  const out: ScrapedExperience[] = [];
  for (const item of items) {
    const entry = compact<ScrapedExperience>({
      title: textOf(item, ["[data-test=experience-title]", ".job-title", ".experience__title"]),
      company: textOf(item, [
        "[data-test=experience-company]",
        ".company",
        ".experience__company",
      ]),
      duration: textOf(item, [
        "[data-test=experience-duration]",
        ".duration",
        ".experience__duration",
        "time",
      ]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Application history from the user's OWN "my applications" panel. On Jobinja the
 * applications list lives on a separate route; if the import is run there, these
 * rows are present. Best-effort — omitted when not on that page.
 */
function scrapeApplications(root: ParentNode): ScrapedApplication[] | undefined {
  const rows = elementsOf(root, [
    "[data-test=application-row]",
    ".c-applicationsList__item",
    ".applications__item",
    "table.applications tbody tr",
  ]);
  const out: ScrapedApplication[] = [];
  for (const row of rows) {
    const entry = compact<ScrapedApplication>({
      title: textOf(row, ["[data-test=application-title]", ".job-title", "td.title", ".title"]),
      company: textOf(row, ["[data-test=application-company]", ".company", "td.company"]),
      url: attrOf(row, ["a[href*='/jobs/']", "a.job-link", "a"], "href"),
      status: textOf(row, ["[data-test=application-status]", ".status", "td.status"]),
      appliedAt: textOf(row, ["[data-test=application-date]", ".date", "td.date", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/* ── content-script wiring (browser only) ──────────────────────────────────
 * Behind a runtime guard so importing this module in a unit test (to call the
 * pure scraper) does NOT touch chrome.* APIs. `chrome` is the @types/chrome
 * ambient global; `typeof chrome` is safe even when it is undefined at runtime.
 */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerJobinjaImportHandler();
}

/** Register the SCRAPE_PROFILE handler. Separated so the guard above stays tiny. */
export function registerJobinjaImportHandler(): void {
  chrome.runtime.onMessage.addListener((msg: BackgroundToImportContent, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_PROFILE" && msg.board === "jobinja") {
      // Prefer Jobinja's own API (the cv-builder is a JS app → the DOM is empty
      // before hydration). Fall back to DOM scraping if the API yields nothing.
      void (async () => {
        try {
          const apiProfile = await scrapeJobinjaViaApi();
          if (apiProfile) {
            sendResponse({ ok: true, profile: apiProfile });
            return;
          }
        } catch {
          /* fall through to DOM scraping */
        }
        sendResponse(toScrapeResult(scrapeJobinjaProfile(document)));
      })();
      return true; // async response — channel kept open above
    }
    return undefined;
  });
}
