/**
 * JobVision profile-import content script (jobvision.ir).
 *
 * JobVision is an Angular SPA: the résumé page is rendered client-side. We read
 * the user's OWN rendered résumé DOM (read-only) and return structured DATA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10): reads the user's OWN logged-in résumé page DOM only. Extracts
 * DATA (text) — NEVER the localStorage JWT / any token / cookie. Never writes,
 * never submits. The DATA is re-scanned by the payload builder before leaving the
 * browser. No detection-evasion.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * SCAFFOLD: selectors below are best-effort placeholders and MUST be verified
 * against a real JobVision résumé page (the Angular component classes are
 * hashed/versioned). TODO(real-account): capture the live résumé DOM and tighten
 * these selectors; until then the scraper falls back gracefully and omits fields
 * it cannot find (it never guesses).
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

/** PURE: map a JobVision résumé DOM subtree → ScrapedProfile. Unit-tested via linkedom. */
export function scrapeJobvisionProfile(root: ParentNode): ScrapedProfile {
  const fullName = textOf(root, [
    "[data-test=full-name]",
    ".resume-header .full-name",
    ".profile-name",
    "h1.name",
  ]);

  const headline = textOf(root, [
    "[data-test=job-title]",
    ".resume-header .job-title",
    ".profile-headline",
    ".current-position",
  ]);

  const city = textOf(root, [
    "[data-test=city]",
    ".resume-header .location",
    ".profile-location",
    ".city",
  ]);

  const resumeText = textOf(root, [
    "[data-test=about]",
    ".resume-about .text",
    ".about-me",
    ".summary",
  ]);

  const yearsExperience = parseYears(
    textOf(root, ["[data-test=experience-years]", ".total-experience", ".years-of-experience"]),
  );

  const skillNodes = textListOf(root, [
    "[data-test=skill]",
    ".skills .skill-chip",
    ".skill-item",
    "app-skills .chip",
  ]);
  const skills =
    skillNodes.length > 0 ? skillNodes : splitSkills(textOf(root, [".skills", ".skill-list"]));

  return compact({
    fullName,
    headline,
    city,
    resumeText,
    yearsExperience,
    skills,
    education: scrapeEducation(root),
    experience: scrapeExperience(root),
    applications: scrapeApplications(root),
  }) as ScrapedProfile;
}

function scrapeEducation(root: ParentNode): ScrapedEducation[] | undefined {
  const items = elementsOf(root, [
    "[data-test=education-item]",
    ".education .education-item",
    "app-education .item",
  ]);
  const out: ScrapedEducation[] = [];
  for (const item of items) {
    const entry = compact<ScrapedEducation>({
      degree: textOf(item, ["[data-test=degree]", ".degree"]),
      field: textOf(item, ["[data-test=field]", ".field-of-study", ".field"]),
      institution: textOf(item, ["[data-test=institution]", ".university", ".institution"]),
      year: textOf(item, ["[data-test=year]", ".year", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

function scrapeExperience(root: ParentNode): ScrapedExperience[] | undefined {
  const items = elementsOf(root, [
    "[data-test=experience-item]",
    ".work-experience .experience-item",
    "app-experience .item",
  ]);
  const out: ScrapedExperience[] = [];
  for (const item of items) {
    const entry = compact<ScrapedExperience>({
      title: textOf(item, ["[data-test=position]", ".position", ".job-title"]),
      company: textOf(item, ["[data-test=company]", ".company-name", ".company"]),
      duration: textOf(item, ["[data-test=duration]", ".duration", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/** The user's own "my applications" list (separate SPA route). Best-effort. */
function scrapeApplications(root: ParentNode): ScrapedApplication[] | undefined {
  const rows = elementsOf(root, [
    "[data-test=application-row]",
    ".my-applications .application-card",
    "app-my-applications .item",
  ]);
  const out: ScrapedApplication[] = [];
  for (const row of rows) {
    const entry = compact<ScrapedApplication>({
      title: textOf(row, ["[data-test=app-title]", ".job-title", ".title"]),
      company: textOf(row, ["[data-test=app-company]", ".company"]),
      url: attrOf(row, ["a[href*='/jobs/']", "a"], "href"),
      status: textOf(row, ["[data-test=app-status]", ".status"]),
      appliedAt: textOf(row, ["[data-test=app-date]", ".date", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerJobvisionImportHandler();
}

export function registerJobvisionImportHandler(): void {
  chrome.runtime.onMessage.addListener((msg: BackgroundToImportContent, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_PROFILE" && msg.board === "jobvision") {
      sendResponse(toScrapeResult(scrapeJobvisionProfile(document)));
      return true;
    }
    return undefined;
  });
}
