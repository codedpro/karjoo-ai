/**
 * e-estekhdam profile-import content script (e-estekhdam.com).
 *
 * e-estekhdam is server-rendered, so the user's profile page is plain HTML. We
 * read the user's OWN profile DOM (read-only) and return structured DATA.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10): reads the user's OWN logged-in profile page DOM only.
 * Extracts DATA (text) — NEVER the session cookie / any token / credential.
 * Never writes, never submits. DATA is re-scanned by the payload builder before
 * leaving the browser. No detection-evasion.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * SCAFFOLD: selectors are best-effort. TODO(real-account): verify against a live
 * e-estekhdam profile page and tighten. Missing fields are omitted, never guessed.
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

/** PURE: map an e-estekhdam profile DOM subtree → ScrapedProfile. Unit-tested via linkedom. */
export function scrapeEestekhdamProfile(root: ParentNode): ScrapedProfile {
  const fullName = textOf(root, [
    "[data-test=full-name]",
    ".profile-header__name",
    ".user-name",
    "h1.name",
  ]);

  const headline = textOf(root, [
    "[data-test=headline]",
    ".profile-header__title",
    ".user-job-title",
    ".headline",
  ]);

  const city = textOf(root, [
    "[data-test=city]",
    ".profile-header__location",
    ".user-city",
    ".location",
  ]);

  const resumeText = textOf(root, [
    "[data-test=about]",
    ".profile-about",
    ".about-section .text",
    ".summary",
  ]);

  const yearsExperience = parseYears(
    textOf(root, ["[data-test=experience-years]", ".experience-years", ".total-experience"]),
  );

  const skillNodes = textListOf(root, [
    "[data-test=skill]",
    ".skills-list .skill",
    ".skill-badge",
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
    ".education-list .education-item",
    ".education .item",
  ]);
  const out: ScrapedEducation[] = [];
  for (const item of items) {
    const entry = compact<ScrapedEducation>({
      degree: textOf(item, ["[data-test=degree]", ".degree"]),
      field: textOf(item, ["[data-test=field]", ".field"]),
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
    ".experience-list .experience-item",
    ".experience .item",
  ]);
  const out: ScrapedExperience[] = [];
  for (const item of items) {
    const entry = compact<ScrapedExperience>({
      title: textOf(item, ["[data-test=position]", ".position", ".job-title"]),
      company: textOf(item, ["[data-test=company]", ".company"]),
      duration: textOf(item, ["[data-test=duration]", ".duration", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/** The user's own application history, if rendered on this page. Best-effort. */
function scrapeApplications(root: ParentNode): ScrapedApplication[] | undefined {
  const rows = elementsOf(root, [
    "[data-test=application-row]",
    ".applications-list .application-item",
    "table.applications tbody tr",
  ]);
  const out: ScrapedApplication[] = [];
  for (const row of rows) {
    const entry = compact<ScrapedApplication>({
      title: textOf(row, ["[data-test=app-title]", ".job-title", ".title", "td.title"]),
      company: textOf(row, ["[data-test=app-company]", ".company", "td.company"]),
      url: attrOf(row, ["a[href*='/job']", "a"], "href"),
      status: textOf(row, ["[data-test=app-status]", ".status", "td.status"]),
      appliedAt: textOf(row, ["[data-test=app-date]", ".date", "td.date", "time"]),
    });
    if (hasAnyValue(entry)) out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerEestekhdamImportHandler();
}

export function registerEestekhdamImportHandler(): void {
  chrome.runtime.onMessage.addListener((msg: BackgroundToImportContent, _sender, sendResponse) => {
    if (msg.type === "SCRAPE_PROFILE" && msg.board === "e-estekhdam") {
      sendResponse(toScrapeResult(scrapeEestekhdamProfile(document)));
      return true;
    }
    return undefined;
  });
}
