/**
 * IranTalent profile-import content script (irantalent.com).
 *
 * IranTalent is an SPA; the profile/CV page is rendered client-side. We read the
 * user's OWN rendered profile DOM (read-only) and return structured DATA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10): reads the user's OWN logged-in profile page DOM only.
 * Extracts DATA (text) — NEVER the localStorage token / cookie / any credential.
 * Never writes, never submits. DATA is re-scanned by the payload builder before
 * leaving the browser. No detection-evasion.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * SCAFFOLD: selectors are best-effort. TODO(real-account): verify against a live
 * IranTalent profile/CV page (component classes are framework-generated) and
 * tighten. Missing fields are omitted, never guessed.
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
import type { BackgroundToContent } from "@ext/lib/messages";
import type {
  ScrapedProfile,
  ScrapedEducation,
  ScrapedExperience,
  ScrapedApplication,
} from "@ext/lib/import-types";

/** PURE: map an IranTalent profile DOM subtree → ScrapedProfile. Unit-tested via linkedom. */
export function scrapeIrantalentProfile(root: ParentNode): ScrapedProfile {
  const fullName = textOf(root, [
    "[data-test=full-name]",
    ".profile-summary__name",
    ".candidate-name",
    "h1.name",
  ]);

  const headline = textOf(root, [
    "[data-test=headline]",
    ".profile-summary__title",
    ".candidate-headline",
    ".job-title",
  ]);

  const city = textOf(root, [
    "[data-test=city]",
    ".profile-summary__location",
    ".candidate-location",
    ".location",
  ]);

  const resumeText = textOf(root, [
    "[data-test=about]",
    ".profile-about__text",
    ".summary",
    ".about-me",
  ]);

  const yearsExperience = parseYears(
    textOf(root, ["[data-test=experience-years]", ".experience-years", ".total-experience"]),
  );

  const skillNodes = textListOf(root, [
    "[data-test=skill]",
    ".skills__chip",
    ".skill-tag",
    "ul.skills li",
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
    ".education-section .education-item",
    ".education .item",
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
    ".experience-section .experience-item",
    ".experience .item",
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

/** The user's own application history (separate SPA route). Best-effort. */
function scrapeApplications(root: ParentNode): ScrapedApplication[] | undefined {
  const rows = elementsOf(root, [
    "[data-test=application-row]",
    ".applications .application-card",
    ".my-applications .item",
  ]);
  const out: ScrapedApplication[] = [];
  for (const row of rows) {
    const entry = compact<ScrapedApplication>({
      title: textOf(row, ["[data-test=app-title]", ".job-title", ".title"]),
      company: textOf(row, ["[data-test=app-company]", ".company"]),
      url: attrOf(row, ["a[href*='/job']", "a"], "href"),
      status: textOf(row, ["[data-test=app-status]", ".status"]),
      appliedAt: textOf(row, ["[data-test=app-date]", ".date", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
// IranTalent's login state is decided in the BACKGROUND from the site's own
// first-party auth cookie (see lib/irantalent-session.ts), so this script only
// answers SCRAPE_PROFILE — read the user's OWN profile DOM and return DATA.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerIrantalentImportHandler();
}

export function registerIrantalentImportHandler(): void {
  chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_PROFILE" && msg.board === "irantalent") {
      sendResponse(toScrapeResult(scrapeIrantalentProfile(document)));
      return true;
    }
    return undefined;
  });
}
