import type { BrowserDiscoveredListing } from "@ext/lib/types";

const ORIGIN = "https://www.e-estekhdam.com";
const SEARCH_URL = `${ORIGIN}/search-api/search`;

interface DiscoveryOptions {
  categoryKeys: string[];
  cities: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const data = record(value);
  for (const key of ["items", "rows", "results", "jobs"]) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return [];
}

function plainText(value: unknown): string | undefined {
  const input = text(value);
  if (!input) return undefined;
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: unknown, uuid: string): string {
  const url = text(value);
  if (!url) return `${ORIGIN}/jobs/k${uuid}`;
  try {
    return new URL(url, ORIGIN).toString();
  } catch {
    return `${ORIGIN}/jobs/k${uuid}`;
  }
}

function normalizedGender(value: unknown): string | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "male" || raw === "1" || /آقا|مرد/.test(raw)) return "male";
  if (raw === "female" || raw === "2" || /خانم|زن/.test(raw)) return "female";
  return null;
}

export function mapEEstekhdamDetail(
  searchValue: unknown,
  detailValue: unknown,
): BrowserDiscoveredListing | null {
  const search = record(searchValue);
  const detail = record(record(detailValue).data ?? detailValue);
  if (search.ats !== true || detail.ats !== true) return null;
  const uuid = text(detail.uuid) ?? text(search.uuid);
  const id = detail.id ?? search.id;
  const title = text(detail.shortTitle) ?? text(detail.title) ?? text(search.short_title) ?? text(search.title);
  const date = text(detail.date);
  if (!uuid || id === undefined || !title || !date) return null;
  const postedAt = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(postedAt.getTime())) return null;
  const employer = record(detail.employer);
  const qualifications = Array.isArray(detail.otherqualifications)
    ? detail.otherqualifications.map(plainText).filter(Boolean)
    : [];
  const description = [
    plainText(detail.top),
    ...qualifications,
    plainText(detail.hours),
    plainText(detail.benefits),
  ].filter(Boolean).join("\n");
  return {
    externalId: String(id),
    title,
    company: text(employer.name) ?? text(search.brand_name) ?? null,
    city: text(detail.city) ?? text(detail.location) ?? text(search.location) ?? null,
    url: absoluteUrl(detail.url ?? search.url, uuid),
    description: description || null,
    salary: text(detail.salary) ?? text(search.salary) ?? null,
    postedAt: postedAt.toISOString(),
    gender: normalizedGender(detail.gender ?? search.gender),
    alreadyApplied: false,
  };
}

async function detailFor(row: unknown, fetchImpl: typeof fetch): Promise<BrowserDiscoveredListing | null> {
  const uuid = text(record(row).uuid);
  if (!uuid) return null;
  const response = await fetchImpl(`${ORIGIN}/search-api/jobs/k${encodeURIComponent(uuid)}`, {
    headers: { accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return mapEEstekhdamDetail(row, payload);
}

export async function discoverEEstekhdamListings(
  options: DiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
  onPage?: (count: number) => Promise<void> | void,
): Promise<BrowserDiscoveredListing[]> {
  const cutoff = Date.now() - Math.min(45, Math.max(1, options.maxAgeDays)) * 86_400_000;
  const contracts = [...options.employmentTypeKeys];
  if (options.remoteOnly && !contracts.includes("دورکاری")) contracts.push("دورکاری");
  const found = new Map<string, BrowserDiscoveredListing>();

  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(`${SEARCH_URL}?page=${page}`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        position: options.categoryKeys,
        where: options.cities,
        contract: contracts,
        sort: "جدیدترین",
        ...(options.maxAgeDays <= 30 ? { posted: [String(options.maxAgeDays)] } : {}),
      }),
    });
    if (response.status === 429) throw new Error("eestekhdam_security_challenge: discovery rate limited");
    if (!response.ok) throw new Error(`eestekhdam_discovery_failed: ${response.status}`);
    const payload = await response.json() as { data?: unknown };
    const rows = rowsOf(payload.data);
    if (rows.length === 0) break;
    const atsRows = rows.filter((row) => record(row).ats === true);
    const details = await Promise.all(atsRows.map((row) => detailFor(row, fetchImpl)));
    let oldest = Number.POSITIVE_INFINITY;
    for (const listing of details) {
      if (!listing) continue;
      const time = Date.parse(listing.postedAt);
      oldest = Math.min(oldest, time);
      if (time >= cutoff) found.set(listing.externalId, listing);
    }
    await onPage?.(found.size);
    if (rows.length < 20 || oldest < cutoff) break;
  }
  return [...found.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}
