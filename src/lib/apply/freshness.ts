import type { JobListing } from "@/lib/apply/types";

export const MAX_PROVIDER_SYNC_AGE_DAYS = 45;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function providerSyncCutoff(now = new Date()): Date {
  return new Date(now.getTime() - MAX_PROVIDER_SYNC_AGE_DAYS * MS_PER_DAY);
}

export function isFreshProviderDate(value: Date | string | null | undefined, now = new Date()): boolean {
  const date = typeof value === "string" ? toPostedDate(value) : value;
  return !!date && date.getTime() >= providerSyncCutoff(now).getTime();
}

export function isFreshJobPosting(job: Pick<JobListing, "postedAt">, now = new Date()): boolean {
  return isFreshProviderDate(job.postedAt, now);
}

export function toPostedDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const relative = relativePostedDate(value);
  if (relative) return relative;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDigits(input: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const faIdx = fa.indexOf(ch);
    if (faIdx >= 0) return String(faIdx);
    const arIdx = ar.indexOf(ch);
    return arIdx >= 0 ? String(arIdx) : ch;
  });
}

function relativePostedDate(raw: string, now = new Date()): Date | null {
  const text = normalizeDigits(raw).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  let days: number | null = null;
  if (/^(امروز|today)$/i.test(text)) days = 0;
  else if (/^(دیروز|yesterday)$/i.test(text)) days = 1;
  else {
    const match = /(\d+)\s*(روز|day|days|هفته|week|weeks|ماه|month|months)\s*(?:پیش|ago)?/i.exec(text);
    if (match) {
      const n = Number(match[1]);
      const unit = match[2];
      if (Number.isFinite(n)) {
        if (/روز|day/i.test(unit)) days = n;
        else if (/هفته|week/i.test(unit)) days = n * 7;
        else if (/ماه|month/i.test(unit)) days = n * 30;
      }
    }
  }
  if (days === null) return null;
  return new Date(now.getTime() - days * MS_PER_DAY);
}
