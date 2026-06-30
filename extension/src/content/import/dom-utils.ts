/**
 * Shared, PURE DOM helpers for the profile-import scrapers.
 *
 * Every function here is READ-ONLY: it queries text out of a DOM subtree and
 * returns plain strings/numbers. Nothing writes to the page, clicks, submits, or
 * reads cookies/localStorage. These helpers are deliberately decoupled from the
 * global `document` (they take a `ParentNode`) so the per-board mappers are pure
 * functions, unit-tested against HTML fixtures with no real browser.
 *
 * LEGITIMACY (§10): scraping is limited to the user's OWN profile page DOM, in
 * the user's own logged-in browser. We extract DATA (text), never credentials.
 */
import type { ScrapedProfile, ScrapeProfileResult } from "@ext/lib/import-types";

/** Collapse whitespace and trim. Returns undefined for empty/whitespace input. */
export function cleanText(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : undefined;
}

/** textContent of the FIRST matching element for any selector, cleaned. */
export function textOf(root: ParentNode, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = root.querySelector(sel);
    } catch {
      continue; // tolerate an invalid selector rather than throwing mid-scrape
    }
    if (el) {
      const t = cleanText(el.textContent);
      if (t) return t;
    }
  }
  return undefined;
}

/** A named attribute of the first matching element (e.g. href), cleaned. */
export function attrOf(root: ParentNode, selectors: string[], attr: string): string | undefined {
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = root.querySelector(sel);
    } catch {
      continue;
    }
    if (el) {
      const v = cleanText(el.getAttribute(attr));
      if (v) return v;
    }
  }
  return undefined;
}

/** Cleaned textContent of EVERY element matching any selector (deduped, in order). */
export function textListOf(root: ParentNode, selectors: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sel of selectors) {
    let nodes: Element[] = [];
    try {
      nodes = Array.from(root.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const node of nodes) {
      const t = cleanText(node.textContent);
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** Every element matching any selector, as an array (first non-empty selector wins). */
export function elementsOf(root: ParentNode, selectors: string[]): Element[] {
  for (const sel of selectors) {
    let nodes: Element[] = [];
    try {
      nodes = Array.from(root.querySelectorAll(sel));
    } catch {
      continue;
    }
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/**
 * Parse a years-of-experience integer out of free text. Understands Persian and
 * ASCII digits and phrasings like "۵ سال سابقه" / "5 years". Returns undefined
 * when no plausible number (0–60) is found.
 */
export function parseYears(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const ascii = toAsciiDigits(raw);
  const m = ascii.match(/(\d{1,2})/);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) && n >= 0 && n <= 60 ? n : undefined;
}

/** Convert Persian/Arabic-Indic digits to ASCII so Number parsing works. */
export function toAsciiDigits(s: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = fa.indexOf(d);
    if (i >= 0) return String(i);
    const j = ar.indexOf(d);
    return j >= 0 ? String(j) : d;
  });
}

/**
 * Split a free-text skills blob into individual skills. Handles comma (ASCII and
 * Persian "،"), middot, slash, pipe, and newlines. Trims, drops empties, dedupes.
 */
export function splitSkills(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts = raw.split(/[,،;|/•\n]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const t = cleanText(p);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Drop undefined/empty fields so a record only carries the keys we actually found. */
export function compact<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** True when an object has at least one meaningful (non-empty) value. */
export function hasAnyValue(obj: object): boolean {
  return Object.values(compact(obj)).length > 0;
}

/**
 * Wrap a scraped profile in the SCRAPE_PROFILE response envelope. ok=false (with
 * a Persian hint) when nothing meaningful was extracted — typically because the
 * user is not on their own profile page. Shared by every board scraper.
 */
export function toScrapeResult(profile: ScrapedProfile): ScrapeProfileResult {
  return Object.keys(profile).length > 0
    ? { ok: true, profile }
    : {
        ok: false,
        message:
          "صفحه‌ی پروفایل/رزومه پیدا نشد. صفحه‌ی رزومه‌ی خودتان را در سایت باز کنید و دوباره تلاش کنید.",
      };
}
