import type { BrowserDiscoveredListing } from "@ext/lib/types";

const LIST_URL = "https://candidateapi.jobvision.ir/api/v1/JobPost/List";

interface DiscoveryOptions {
  categoryKeys: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
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

function matchesEmployment(item: Record<string, unknown>, keys: string[]): boolean {
  if (keys.length === 0) return true;
  const workType = record(item.workType);
  const haystack = `${text(workType.titleFa) ?? ""} ${text(workType.titleEn) ?? ""}`.toLowerCase();
  return keys.some((key) => {
    const normalized = key.toLowerCase().replaceAll("-", " ");
    if (normalized === "full time") return /full time|تمام وقت/.test(haystack);
    if (normalized === "part time") return /part time|پاره وقت/.test(haystack);
    if (normalized === "project based") return /project|قراردادی|پروژه/.test(haystack);
    return haystack.includes(normalized);
  });
}

export function mapJobvisionListing(value: unknown): BrowserDiscoveredListing | null {
  const item = record(value);
  const id = typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : "";
  const title = text(item.title);
  const firstActivation = record(item.firstActivationTime);
  const activation = record(item.activationTime);
  const postedAt = text(firstActivation.date) ?? text(activation.date);
  if (!id || !title || !postedAt || !Number.isFinite(new Date(postedAt).getTime())) return null;
  const company = record(item.company);
  const location = record(item.location);
  const city = record(location.city);
  const province = record(location.province);
  const salary = record(item.salary);
  const gender = record(item.gender);
  const userInfo = record(item.userJobPostInfo);
  const properties = record(item.properties);
  const expire = record(item.expireTime);
  const workType = record(item.workType);
  const description = [
    text(workType.titleFa),
    properties.isRemote === true ? "دورکاری" : undefined,
  ].filter(Boolean).join(" · ");
  return {
    externalId: id,
    title,
    company: text(company.nameFa) ?? text(company.nameEn) ?? null,
    city: text(city.titleFa) ?? text(province.titleFa) ?? null,
    url: `https://jobvision.ir/jobs/${id}`,
    description: description || null,
    salary: text(salary.titleFa) ?? null,
    postedAt: new Date(postedAt).toISOString(),
    gender: text(gender.titleFa) ?? null,
    alreadyApplied: userInfo.isApplied === true || userInfo.isCanceledApply === true || expire.isExpired === true,
  };
}

export async function discoverJobvisionListings(
  options: DiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
  onPage?: (count: number) => Promise<void> | void,
): Promise<BrowserDiscoveredListing[]> {
  const cutoff = Date.now() - Math.min(45, Math.max(1, options.maxAgeDays)) * 86_400_000;
  const categories = options.categoryKeys.length > 0 ? options.categoryKeys : [null];
  const found = new Map<string, BrowserDiscoveredListing>();

  for (const category of categories) {
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while ((page - 1) * 100 < total) {
      const body = {
        pageSize: 100,
        requestedPage: page,
        sortBy: 1,
        searchId: null,
        ...(category ? { jobCategoryUrlTitle: category } : {}),
        ...(options.remoteOnly ? { isRemote: true } : {}),
      };
      const response = await fetchImpl(LIST_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "ngsw-bypass": "true" },
        body: JSON.stringify(body),
      });
      if (response.status === 401 || response.status === 403) throw new Error("jobvision_login_required: discovery blocked");
      if (response.status === 429) throw new Error("jobvision_security_challenge: discovery rate limited");
      if (!response.ok) throw new Error(`jobvision_discovery_failed: ${response.status}`);
      const payload = await response.json() as { data?: Record<string, unknown> };
      const data = record(payload.data);
      const rows = Array.isArray(data.jobPosts) ? data.jobPosts : [];
      total = typeof data.jobPostCount === "number" ? data.jobPostCount : rows.length;
      let pageHasFresh = false;
      for (const row of rows) {
        const item = record(row);
        const listing = mapJobvisionListing(item);
        if (!listing || new Date(listing.postedAt).getTime() < cutoff) continue;
        pageHasFresh = true;
        if (!matchesEmployment(item, options.employmentTypeKeys)) continue;
        found.set(listing.externalId, listing);
      }
      await onPage?.(found.size);
      if (rows.length === 0 || (!pageHasFresh && page > 1)) break;
      if (options.maxListings !== undefined && found.size >= options.maxListings) break;
      if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
      page += 1;
    }
  }
  return [...found.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}
