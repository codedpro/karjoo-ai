export interface JobinjaHistoryProof extends Record<string, unknown> {
  provider: "jobinja";
  signal: "application_history";
  jobId: string;
  checkedAt: string;
}

export interface JobinjaHistoryApplication {
  externalId: string;
  title?: string;
  company?: string;
  url?: string;
  statusRaw?: string;
  appliedAt?: string;
}

export interface JobinjaHistorySyncResult {
  applications: JobinjaHistoryApplication[];
  complete: boolean;
}

interface ParsedHistoryPage {
  applications: JobinjaHistoryApplication[];
  currentPage: number;
  lastPage: number;
  foundState: boolean;
}

const FA_MONTHS: Record<string, number> = {
  فروردین: 1, اردیبهشت: 2, خرداد: 3, تیر: 4, مرداد: 5, امرداد: 5,
  شهریور: 6, مهر: 7, آبان: 8, آذر: 9, دی: 10, بهمن: 11, اسفند: 12,
};

function latinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    return String(fa >= 0 ? fa : "٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  });
}

function jalaliDate(value: string | null | undefined): Date | null {
  const match = /^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})$/.exec(latinDigits(value?.trim() ?? ""));
  if (!match) return null;
  const jy = Number(match[3]);
  const jm = FA_MONTHS[match[2]!.replace(/\u200c/g, "")];
  const jd = Number(match[1]);
  if (!jy || !jm || !jd) return null;
  let gy = jy > 979 ? 1600 : 621;
  const y = jy > 979 ? jy - 979 : jy;
  let days = 365 * y + Math.floor(y / 33) * 8 + Math.floor(((y % 33) + 3) / 4) +
    78 + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let day = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let month = 1;
  while (month <= 12 && day > monthDays[month]!) day -= monthDays[month++]!;
  return new Date(Date.UTC(gy, month - 1, day));
}

export function parseJobinjaHistoryPage(html: string): ParsedHistoryPage {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const element of parsed.querySelectorAll("[init-state]")) {
    const raw = element.getAttribute("init-state");
    if (!raw) continue;
    try {
      const state = JSON.parse(raw) as {
        applications?: {
          current_page?: number;
          last_page?: number;
          data?: Array<{
            short_id?: string;
            id?: string | number;
            status?: string;
            created_at?: string;
            job_link?: string;
            details_link?: string;
            job?: { title?: string; company?: { persian_name?: string; english_name?: string; name?: string } };
          }>;
        };
      };
      if (!state.applications) continue;
      const applications = (state.applications.data ?? []).flatMap((item) => {
        const url = item.job_link ?? item.details_link;
        const externalId = String(item.short_id ?? item.id ?? jobinjaJobId(url) ?? "").trim();
        if (!externalId) return [];
        const appliedAt = jalaliDate(item.created_at)?.toISOString();
        const company = item.job?.company?.persian_name ?? item.job?.company?.english_name ?? item.job?.company?.name;
        return [{
          externalId,
          ...(item.job?.title ? { title: item.job.title } : {}),
          ...(company ? { company } : {}),
          ...(url ? { url } : {}),
          ...(item.status ? { statusRaw: item.status } : {}),
          ...(appliedAt ? { appliedAt } : {}),
        }];
      });
      return {
        applications,
        currentPage: Number(state.applications.current_page ?? 1),
        lastPage: Number(state.applications.last_page ?? 1),
        foundState: true,
      };
    } catch {
      // Keep looking: unrelated Jobinja components also carry init-state.
    }
  }
  return { applications: [], currentPage: 1, lastPage: 1, foundState: false };
}

export async function syncJobinjaApplicationHistory(
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<JobinjaHistorySyncResult> {
  const cutoff = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const applications: JobinjaHistoryApplication[] = [];
  for (let page = 1; page <= 120; page += 1) {
    try {
      const response = await fetchImpl(`https://jobinja.ir/jobs/applied${page === 1 ? "" : `?page=${page}`}`, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (!response.ok || /\/login(?:\/|$)/.test(new URL(response.url).pathname)) {
        return { applications, complete: false };
      }
      const parsed = parseJobinjaHistoryPage(await response.text());
      if (!parsed.foundState) return { applications, complete: false };
      const dated = parsed.applications.flatMap((item) => item.appliedAt ? [new Date(item.appliedAt)] : []);
      applications.push(...parsed.applications.filter((item) => !item.appliedAt || new Date(item.appliedAt) >= cutoff));
      const reachedCutoff = dated.some((date) => date <= cutoff);
      if (reachedCutoff || parsed.currentPage >= parsed.lastPage) {
        return { applications, complete: true };
      }
    } catch {
      return { applications, complete: false };
    }
  }
  return { applications, complete: false };
}

export function jobinjaJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://jobinja.ir");
    if (!/(^|\.)jobinja\.ir$/i.test(parsed.hostname)) return null;
    return /\/jobs\/([A-Za-z0-9]+)/.exec(parsed.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function jobIdsFromAppliedHistory(html: string): Set<string> {
  const ids = new Set<string>();
  for (const application of parseJobinjaHistoryPage(html).applications) {
    const id = jobinjaJobId(application.url);
    if (id) ids.add(id);
  }
  return ids;
}

export async function verifyJobinjaApplicationHistory(
  jobUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JobinjaHistoryProof | null> {
  const jobId = jobinjaJobId(jobUrl);
  if (!jobId) return null;
  try {
    const response = await fetchImpl("https://jobinja.ir/jobs/applied", {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!response.ok || /\/login(?:\/|$)/.test(new URL(response.url).pathname)) return null;
    const ids = jobIdsFromAppliedHistory(await response.text());
    if (!ids.has(jobId)) return null;
    return {
      provider: "jobinja",
      signal: "application_history",
      jobId,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
