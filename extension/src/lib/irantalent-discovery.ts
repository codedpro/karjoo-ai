import type { BrowserDiscoveredListing } from "@ext/lib/types";
import { clampProviderAgeDays, MS_PER_DAY } from "@ext/lib/freshness";

/**
 * IranTalent public job discovery.
 *
 * irantalent.com is an Angular SPA that reads its data from a separate JSON API
 * (`https://api.irantalent.com/api/v1`). Job search is a public POST endpoint —
 * the same one the site's own bundle calls — so discovery needs no credentials.
 * When the user IS signed in, an optional bearer token (built by the caller from
 * the site's own `auth_token_irantalent_new` cookie, in the user's own browser)
 * makes the API return a per-user `is_applied`, which lets us skip jobs the user
 * has already applied to instead of queueing them.
 *
 * The list rows carry everything we need except the gender restriction, which
 * lives only on the position detail; details are fetched for the rows that
 * survive the cheap exclusions, in bounded batches.
 */
const API_ROOT = "https://api.irantalent.com/api/v1";
const SEARCH_URL = `${API_ROOT}/employer/position/search`;
const SITE_ORIGIN = "https://www.irantalent.com";

/** Position status ids that mean "live" — everything else is closed/removed. */
const LIVE_STATUS_IDS = new Set([169, 170]);

/** How many position details to fetch at once, and the ceiling for one run. */
const DETAIL_CONCURRENCY = 6;
const MAX_DETAIL_FETCHES = 400;

export interface IranTalentDiscoveryOptions {
  /** Lookup ids of type 42 (job-category filter groups). */
  categoryKeys: string[];
  /** Lookup ids of type 17 (employment types). */
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
  /** `"<token_type> <access_token>"`, when a local IranTalent session exists. */
  authorization?: string | null;
  /** Unix ms after which pagination stops, even mid-board. */
  deadlineAt?: number;
  /** Hard ceiling on listings collected in one pass. */
  maxListings?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numericIds(keys: string[]): number[] {
  return keys.map((key) => Number(key)).filter((id) => Number.isInteger(id) && id > 0);
}

function plainText(value: unknown): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&bull;|&#8226;/gi, "•")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * IranTalent's `lived_at` is Tehran wall-clock (`YYYY-MM-DD HH:mm:ss`) on the
 * list endpoint and a UTC ISO string on the detail endpoint. Normalize both.
 */
export function parseIranTalentDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}+03:30`
    : raw;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * IranTalent stores the gender restriction as a tri-state boolean:
 * `true` → men only, `false` → women only, `null` → open to anyone. Emit the
 * Persian words the server-side gender filter actually matches on.
 */
export function normalizedGender(value: unknown): string | null {
  if (value === true) return "آقا";
  if (value === false) return "خانم";
  return null;
}

/** The canonical SPA route for a position: /job/:slug/:position_id. */
export function irantalentJobUrl(slug: unknown, id: number | string): string {
  const safeSlug = text(slug)?.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
  return `${SITE_ORIGIN}/job/${safeSlug}/${id}`;
}

/**
 * PURE: is this search row something we can actually apply to through IranTalent?
 * Excludes closed/removed postings, already-applied ones, and listings that are
 * only a crawled pointer at another site's form.
 */
export function isActionableIranTalentRow(value: unknown): boolean {
  const row = record(value);
  if (row.is_applied === true) return false;
  if (row.is_crawler === true) return false;
  if (text(row.redirection_url)) return false;
  const statusId = record(row.status).id;
  return typeof statusId === "number" && LIVE_STATUS_IDS.has(statusId);
}

/** PURE: search row (optionally enriched with its detail) → normalized listing. */
export function mapIranTalentPosition(
  rowValue: unknown,
  detailValue?: unknown,
): BrowserDiscoveredListing | null {
  const row = record(rowValue);
  const detail = record(record(detailValue).data ?? detailValue);
  const id = row.id ?? detail.id;
  if (typeof id !== "number" && typeof id !== "string") return null;
  const title = text(row.title_farsi) ?? text(row.title) ?? text(detail.title_farsi) ?? text(detail.title);
  const postedAt = parseIranTalentDate(row.lived_at ?? detail.lived_at);
  if (!title || !postedAt) return null;

  const employer = record(row.employer ?? detail.employer);
  const description = [
    plainText(detail.role_description_farsi ?? row.role_description_farsi) ??
      plainText(detail.role_description ?? row.role_description),
    plainText(detail.requirements_description_farsi) ?? plainText(detail.requirements_description),
  ].filter(Boolean).join("\n\n");

  const salaryFrom = row.salary_from ?? detail.salary_from;
  const salaryTo = row.salary_to ?? detail.salary_to;
  const salary =
    (row.is_show_salary ?? detail.is_show_salary) === true && (salaryFrom || salaryTo)
      ? [salaryFrom, salaryTo].filter(Boolean).join(" - ")
      : null;

  return {
    externalId: String(id),
    title,
    company: text(employer.name_farsi) ?? text(employer.title_farsi) ?? text(employer.name) ?? text(employer.title) ?? null,
    city:
      text(row.location_text_farsi) ??
      text(record(row.location).title_farsi) ??
      text(detail.location_text_farsi) ??
      text(record(detail.location).title_farsi) ??
      text(row.location_text) ??
      null,
    url: irantalentJobUrl(row.slug ?? detail.slug, String(id)),
    description: description || null,
    salary,
    postedAt,
    // Only the detail endpoint carries the restriction; absent ⇒ unrestricted.
    gender: normalizedGender(detail.gender ?? null),
    alreadyApplied: row.is_applied === true || detail.is_applied === true,
  };
}

function authHeaders(authorization?: string | null): Record<string, string> {
  return authorization ? { authorization } : {};
}

async function fetchDetail(
  id: string,
  authorization: string | null | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  try {
    const response = await fetchImpl(`${API_ROOT}/employer/position/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json", ...authHeaders(authorization) },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Run `worker` over `items` with a fixed concurrency, preserving order. */
async function mapPooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!);
    }
  });
  await Promise.all(runners);
  return results;
}

/** `YYYY-MM-DD` in Tehran time, which is what the API's date range expects. */
function tehranDate(time: number): string {
  return new Date(time + 3.5 * 3_600_000).toISOString().slice(0, 10);
}

export async function discoverIranTalentListings(
  options: IranTalentDiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
  onPage?: (count: number) => Promise<void> | void,
): Promise<BrowserDiscoveredListing[]> {
  const maxAgeDays = clampProviderAgeDays(options.maxAgeDays);
  const now = Date.now();
  const cutoff = now - maxAgeDays * MS_PER_DAY;
  const body: Record<string, unknown> = {};
  const categoryIds = numericIds(options.categoryKeys);
  const employmentTypeIds = numericIds(options.employmentTypeKeys);
  if (categoryIds.length > 0) body.job_category_ids = categoryIds;
  if (employmentTypeIds.length > 0) body.employment_type_ids = employmentTypeIds;

  // The API's own date window does the coarse 45-day cap server-side; every row
  // is still re-checked against `cutoff` below because the window is day-grained.
  const range = `start_date=${tehranDate(cutoff)}&end_date=${tehranDate(now)}`;
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(`${SEARCH_URL}?${range}&page=${page}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...authHeaders(options.authorization),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("irantalent_login_required: discovery session rejected");
    }
    if (response.status === 429) {
      throw new Error("irantalent_security_challenge: discovery rate limited");
    }
    if (!response.ok) throw new Error(`irantalent_discovery_failed: ${response.status}`);
    const payload = record(await response.json());
    if (!Array.isArray(payload.data)) {
      // A 200 whose body is not the paginated envelope means the search contract
      // moved; fail loudly rather than reporting "no jobs today".
      throw new Error("irantalent_provider_changed: search response shape changed");
    }
    const pageRows = payload.data.map(record);
    if (pageRows.length === 0) break;

    let oldest = Number.POSITIVE_INFINITY;
    for (const row of pageRows) {
      const postedAt = parseIranTalentDate(row.lived_at);
      const time = postedAt ? Date.parse(postedAt) : Number.NaN;
      if (Number.isFinite(time)) oldest = Math.min(oldest, time);
      if (!Number.isFinite(time) || time < cutoff) continue;
      if (!isActionableIranTalentRow(row)) continue;
      const id = String(row.id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
    await onPage?.(rows.length);

    const lastPage = Number(payload.last_page ?? 0);
    if (!payload.next_page_url || (Number.isFinite(lastPage) && page >= lastPage)) break;
    if (oldest < cutoff) break;
    if (options.maxListings !== undefined && rows.length >= options.maxListings) break;
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
  }

  // The gender restriction only exists on the detail endpoint; fetch it for the
  // rows that survived, then drop anything the detail reveals as unusable.
  const detailBudget = Math.min(MAX_DETAIL_FETCHES, options.maxListings ?? MAX_DETAIL_FETCHES);
  const detailRows = rows.slice(0, detailBudget);
  const details = await mapPooled(detailRows, DETAIL_CONCURRENCY, (row) =>
    fetchDetail(String(row.id), options.authorization, fetchImpl),
  );

  const listings: BrowserDiscoveredListing[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const detail = index < details.length ? details[index] : undefined;
    const detailData = record(record(detail).data ?? detail);
    if (detail && Object.keys(detailData).length > 0) {
      if (detailData.is_applied === true || detailData.is_crawler === true) continue;
      if (text(detailData.redirection_url) || text(detailData.apply_redirect_link)) continue;
      const statusId = record(detailData.status).id;
      if (typeof statusId === "number" && !LIVE_STATUS_IDS.has(statusId)) continue;
    }
    const listing = mapIranTalentPosition(row, detail ?? undefined);
    if (!listing || listing.alreadyApplied) continue;
    if (options.remoteOnly && !isRemoteRow(row, detailData)) continue;
    listings.push(listing);
  }

  return listings.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

/**
 * The search API accepts `work_type_ids` but does not honour it, so remote-only
 * targeting is enforced here against the row's own `work_type`.
 */
function isRemoteRow(row: Record<string, unknown>, detail: Record<string, unknown>): boolean {
  const workType = (text(row.work_type) ?? text(detail.work_type) ?? "").toLowerCase();
  return workType === "remote" || workType === "hybrid";
}
