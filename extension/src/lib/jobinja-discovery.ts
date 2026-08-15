import type { BrowserDiscoveredListing } from "@ext/lib/types";

export interface JobinjaDiscoveryPage {
  listings: BrowserDiscoveredListing[];
  nextUrl: string | null;
  oldestPostedAt: string | null;
  securityChallenge: boolean;
  loginRequired: boolean;
  bulkApplyAvailable: boolean;
}

const DAY = 86_400_000;

function text(el: Element | null): string {
  return (el?.textContent ?? "").replace(/[\s\u200c]+/g, " ").trim();
}

function digits(value: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const faIndex = fa.indexOf(char);
    return String(faIndex >= 0 ? faIndex : ar.indexOf(char));
  });
}

export function postedAtFromJobinja(label: string, now = new Date()): string {
  const normalized = digits(label).replace(/[()]/g, " ").trim().toLowerCase();
  let days = 0;
  if (/(دیروز|yesterday)/.test(normalized)) days = 1;
  else if (!/(امروز|today)/.test(normalized)) {
    const count = Number(normalized.match(/\d+/)?.[0] ?? 0);
    if (/(هفته|week)/.test(normalized)) days = count * 7;
    else if (/(ماه|month)/.test(normalized)) days = count * 30;
    else days = count;
  }
  return new Date(now.getTime() - Math.max(0, days) * DAY).toISOString();
}

function cleanUrl(raw: string, baseUrl: string, preserveQuery = false): string | null {
  try {
    const url = new URL(raw, baseUrl);
    if (!/(^|\.)jobinja\.ir$/i.test(url.hostname)) return null;
    if (!preserveQuery) url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseJobinjaDiscoveryPage(
  doc: Document,
  pageUrl: string,
  now = new Date(),
): JobinjaDiscoveryPage {
  const body = text(doc.body).toLowerCase();
  const securityChallenge = [
    "checking your browser before accessing",
    "complete the security check",
    "cf-chl-",
    "recaptcha",
    "بررسی امنیتی",
  ].some((needle) => body.includes(needle));
  const loginRequired = /\/login\/(?:user|login)/.test(doc.location?.pathname ?? "") ||
    Boolean(doc.querySelector("form[action*='/login'], input[type='password']"));

  const listings: BrowserDiscoveredListing[] = [];
  for (const card of doc.querySelectorAll("li.c-jobListView__item")) {
    const anchor = card.querySelector<HTMLAnchorElement>("a.c-jobListView__titleLink");
    const url = anchor?.getAttribute("href") ? cleanUrl(anchor.getAttribute("href")!, pageUrl) : null;
    const externalId = url?.match(/\/jobs\/([A-Za-z0-9]+)(?:\/|$)/)?.[1];
    const title = text(anchor);
    if (!url || !externalId || !title) continue;

    const meta = Array.from(card.querySelectorAll(".c-jobListView__metaItem"));
    const company = text(meta[0] ?? null) || null;
    const city = text(meta[1] ?? null) || null;
    const postedAt = postedAtFromJobinja(text(card.querySelector(".c-jobListView__passedDays")), now);
    listings.push({ externalId, title, company, city, url, postedAt });
  }

  const nextHref = doc.querySelector<HTMLAnchorElement>("link[rel='next'], a[rel='next']")?.getAttribute("href");
  const nextUrl = nextHref ? cleanUrl(nextHref, pageUrl, true) : null;
  const oldestPostedAt = listings.reduce<string | null>(
    (oldest, item) => (!oldest || item.postedAt < oldest ? item.postedAt : oldest),
    null,
  );
  const bulkApplyAvailable = Array.from(doc.querySelectorAll("button, a"))
    .some((el) => /(اپلای گروهی|ارسال گروهی|bulk apply)/i.test(text(el)));

  return { listings, nextUrl, oldestPostedAt, securityChallenge, loginRequired, bulkApplyAvailable };
}
