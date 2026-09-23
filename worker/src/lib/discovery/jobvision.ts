/**
 * JobVision discovery for the fleet node — via the sitemap, not the API.
 *
 * The extension reads JobVision through candidateapi.jobvision.ir, but that
 * host's robots.txt is `Disallow: /`. An anonymous, identified crawler must not
 * use it (§10: public aggregation honours robots.txt). The extension is different
 * — it is the user's own browser, not a crawler.
 *
 * JobVision does publish the channel it wants crawlers to use:
 *
 *   1. /sitemap/jobposts.xml lists every live posting (≈57k) with its lastmod.
 *   2. Each posting page (robots-allowed: no query string) embeds a schema.org
 *      `JobPosting` in JSON-LD — title, datePosted, employmentType,
 *      occupationalCategory, organisation, city, location type.
 *
 * So the node reads the sitemap, fetches only postings that are new or changed
 * since its last pass (newest first, capped per run), and parses the JSON-LD.
 * That gives EXACT fields — the occupationalCategory is the same Persian label
 * the user picked in their filter — so per-user matching needs no title guessing.
 * Guessing would put the user's name on jobs they did not ask for.
 */
import { providerCutoffMs, type DiscoveredListing } from "./types.js";

export const JOBVISION_ORIGIN = "https://jobvision.ir";
export const JOBVISION_SITEMAP_URL = `${JOBVISION_ORIGIN}/sitemap/jobposts.xml`;

/** One sitemap row. */
export interface SitemapEntry {
  id: string;
  url: string;
  lastmod: number;
}

/** A JobVision posting with the fields per-user matching needs. */
export interface JobvisionPosting extends DiscoveredListing {
  /** schema.org occupationalCategory — JobVision's Persian category label. */
  category: string | null;
  /** schema.org employmentType, normalised to lower-kebab (e.g. "full-time"). */
  employmentType: string | null;
  remote: boolean;
}

/** What one user wants from JobVision (labels resolved by the control plane). */
export interface JobvisionUserSpec {
  categoryLabels: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** PURE: the sitemap's (loc, lastmod) rows. The id is the numeric path segment. */
export function parseJobpostsSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const match of xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    const url = decodeXml(match[1] ?? "").trim();
    const id = /\/jobs\/(\d+)(?:\/|$)/.exec(url)?.[1];
    const lastmod = Date.parse(match[2] ?? "");
    if (id && Number.isFinite(lastmod)) out.push({ id, url, lastmod });
  }
  return out;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLabel(value: string): string {
  return value.replace(/[‌\s]+/g, " ").trim().toLowerCase();
}

function normalizeType(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = str(raw);
  return text ? text.toLowerCase().replace(/_/g, "-") : null;
}

/** PURE: the JobPosting JSON-LD from a posting page, or null if there is none. */
export function parseJobPostingPage(html: string, url: string, id: string): JobvisionPosting | null {
  for (const match of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1] ?? "");
    } catch {
      continue;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const posting = item as Record<string, unknown>;
      if (posting["@type"] !== "JobPosting") continue;

      const title = str(posting.title);
      const posted = Date.parse(str(posting.datePosted) ?? "");
      if (!title || !Number.isFinite(posted)) return null;

      const org = posting.hiringOrganization as Record<string, unknown> | undefined;
      const rawLocation = posting.jobLocation;
      const location = (Array.isArray(rawLocation) ? rawLocation[0] : rawLocation) as
        | Record<string, unknown>
        | undefined;
      const address = location?.address as Record<string, unknown> | undefined;
      const locationType = str(posting.jobLocationType) ?? "";
      const remote = /telecommute/i.test(locationType) || /دورکاری|remote/i.test(title);

      return {
        externalId: id,
        title,
        company: str(org?.name),
        city: str(address?.addressLocality) ?? str(address?.addressRegion),
        url,
        description: [str(posting.occupationalCategory), remote ? "دورکاری" : null]
          .filter(Boolean)
          .join(" · ") || null,
        postedAt: new Date(posted).toISOString(),
        category: str(posting.occupationalCategory),
        employmentType: normalizeType(posting.employmentType),
        remote,
      };
    }
  }
  return null;
}

/**
 * PURE: does this posting match what the user asked for on JobVision?
 *
 * Category is an EXACT label match — the user picked these labels from
 * JobVision's own list, and occupationalCategory carries the same label. The
 * employment-type rule mirrors the extension's matchesEmployment exactly, so a
 * job the extension would queue is one the node queues too, and vice versa.
 */
export function matchesJobvisionSpec(posting: JobvisionPosting, spec: JobvisionUserSpec): boolean {
  if (spec.remoteOnly && !posting.remote) return false;

  if (spec.categoryLabels.length > 0) {
    const wanted = new Set(spec.categoryLabels.map(normalizeLabel));
    if (!posting.category || !wanted.has(normalizeLabel(posting.category))) return false;
  }

  if (spec.employmentTypeKeys.length > 0) {
    const type = (posting.employmentType ?? "").replaceAll("-", " ");
    const ok = spec.employmentTypeKeys.some((key) => {
      const k = key.toLowerCase().replaceAll("-", " ");
      if (k === "full time") return /full time|تمام وقت/.test(type);
      if (k === "part time") return /part time|پاره وقت/.test(type);
      if (k === "project based") return /project|contract|قراردادی|پروژه/.test(type);
      return type.includes(k);
    });
    if (!ok) return false;
  }
  return true;
}

export interface JobvisionFeedOptions {
  maxAgeDays: number;
  /** Posting pages fetched per pass — bounds a cold start and every later run. */
  maxPagesPerRun?: number;
  deadlineAt?: number;
  now?: () => number;
}

/**
 * The node's rolling view of JobVision.
 *
 * Two jobs: fetch only what is new or changed since the last pass (so each pass
 * is cheap), and RETAIN every fresh posting it has read. The retained window is
 * what per-user matching runs against. Matching only the latest delta would be
 * wrong — users are due every 15 minutes, passes run more often, so a user whose
 * turn fell between two passes would never see the postings those passes read.
 *
 * In memory on purpose: the node is stateless by design. After a restart it
 * rebuilds the window newest-first, capped per run, and the control plane's
 * idempotent ingest absorbs anything sent twice.
 */
export class JobvisionFeed {
  private readonly seen = new Map<string, number>();
  private readonly postings = new Map<string, JobvisionPosting>();

  constructor(private readonly fetchImpl: typeof fetch) {}

  /** Read the sitemap; fetch and retain postings new/changed since the last pass. */
  async refresh(options: JobvisionFeedOptions): Promise<JobvisionPosting[]> {
    const now = options.now ?? Date.now;
    const cutoff = providerCutoffMs(options.maxAgeDays, now());
    const cap = options.maxPagesPerRun ?? 300;
    this.evict(cutoff);

    const response = await this.fetchImpl(JOBVISION_SITEMAP_URL, {
      headers: { accept: "application/xml,text/xml" },
    });
    if (response.status === 429) throw new Error("jobvision_rate_limited: sitemap throttled");
    if (!response.ok) throw new Error(`jobvision_sitemap_failed: ${response.status}`);
    const entries = parseJobpostsSitemap(await response.text())
      .filter((entry) => entry.lastmod >= cutoff && this.seen.get(entry.id) !== entry.lastmod)
      .sort((a, b) => b.lastmod - a.lastmod)
      .slice(0, cap);

    const fresh: JobvisionPosting[] = [];
    for (const entry of entries) {
      if (options.deadlineAt !== undefined && now() >= options.deadlineAt) break;
      let page: Response;
      try {
        page = await this.fetchImpl(entry.url, { headers: { accept: "text/html" } });
      } catch {
        continue; // one unreachable posting must not end the pass
      }
      if (page.status === 429) throw new Error("jobvision_rate_limited: posting pages throttled");
      // Mark seen even on 404: a removed posting will not come back at this lastmod.
      this.seen.set(entry.id, entry.lastmod);
      if (!page.ok) {
        this.postings.delete(entry.id);
        continue;
      }
      const posting = parseJobPostingPage(await page.text(), entry.url, entry.id);
      if (posting && Date.parse(posting.postedAt) >= cutoff) {
        this.postings.set(posting.externalId, posting);
        fresh.push(posting);
      }
    }
    return fresh;
  }

  /** Every retained posting still inside the freshness window. */
  window(maxAgeDays: number, now: number = Date.now()): JobvisionPosting[] {
    const cutoff = providerCutoffMs(maxAgeDays, now);
    return [...this.postings.values()].filter((p) => Date.parse(p.postedAt) >= cutoff);
  }

  get size(): number {
    return this.postings.size;
  }

  private evict(cutoff: number): void {
    for (const [id, posting] of this.postings) {
      if (Date.parse(posting.postedAt) < cutoff) {
        this.postings.delete(id);
        this.seen.delete(id);
      }
    }
  }
}
