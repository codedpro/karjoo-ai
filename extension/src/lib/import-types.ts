/**
 * Shapes for the "import my profile from a job board" feature (WF1 — user-owned
 * data portability with consent).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY RULE 1 (docs/ARCHITECTURE.md §10) — re-stated for this feature:
 *
 *   The extension reads the user's OWN profile/résumé page DOM, in the user's
 *   own logged-in browser, user-present. It extracts ONLY profile DATA — name,
 *   headline, skills, experience, education, application history. It MUST NEVER
 *   read or transmit a cookie / token / password / session / any credential.
 *
 *   These types describe DATA ONLY. There is deliberately NO field for a cookie,
 *   token, header, or any secret material. The payload builder
 *   (import-payload.ts) additionally PROVES at runtime that no credential-shaped
 *   key sneaks in, and the server's /api/profile/import endpoint rejects any
 *   credential-shaped field too (defense in depth across both sides).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BoardId } from "@ext/lib/config";

/** One past job-application record the user can see in their OWN board history. */
export interface ScrapedApplication {
  /** The applied-to job title, as shown on the page. */
  title?: string;
  /** The hiring company name. */
  company?: string;
  /** The job posting URL, if the page links to it. */
  url?: string;
  /** Application status text exactly as the site shows it (raw, not normalized). */
  status?: string;
  /** When the user applied, as a display string (raw — server normalizes later). */
  appliedAt?: string;
}

/** One education entry from the user's own profile. */
export interface ScrapedEducation {
  degree?: string;
  field?: string;
  institution?: string;
  year?: string;
}

/** One work-history entry from the user's own profile. */
export interface ScrapedExperience {
  title?: string;
  company?: string;
  duration?: string;
}

/**
 * The structured DATA a board scraper extracts from the user's OWN profile page.
 * Every field is optional and best-effort: a scraper returns only what it found.
 *
 * This object becomes the `payload` POSTed to /api/profile/import, where the
 * server's per-board normalizer maps it onto the user's CandidateProfile. The
 * server normalizer already understands these common key names (fullName,
 * headline, skills, yearsExperience, city, resumeText, applications), so the
 * extension and server speak the same DATA vocabulary.
 *
 * NOTE: there is intentionally NO cookie/token/password/header field here. If a
 * future edit adds one, both the payload builder and the import endpoint reject
 * the whole payload (fail-closed).
 */
export interface ScrapedProfile {
  fullName?: string;
  headline?: string;
  city?: string;
  /** Free-text résumé summary / "about me" the user wrote about themselves. */
  resumeText?: string;
  yearsExperience?: number;
  skills?: string[];
  education?: ScrapedEducation[];
  experience?: ScrapedExperience[];
  /** The user's own application history on this board. */
  applications?: ScrapedApplication[];
}

/** Result returned by a content script's SCRAPE_PROFILE handler. */
export interface ScrapeProfileResult {
  /** True if at least one meaningful profile field was extracted. */
  ok: boolean;
  /** The extracted DATA (never a credential). Absent when ok=false. */
  profile?: ScrapedProfile;
  /** A human (Persian) explanation when ok=false (e.g. profile page not open). */
  message?: string;
}

/** Per-board import outcome surfaced to the popup (no secret material). */
export interface BoardImportOutcome {
  board: BoardId;
  ok: boolean;
  /** Count of fields/items the server accepted (for the user-facing summary). */
  importedSummary?: string;
  /** A Persian status/error line for the UI. */
  message?: string;
}
