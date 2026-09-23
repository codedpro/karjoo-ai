/**
 * Jobinja discovery for the fleet node.
 *
 * The extension discovers Jobinja by driving a real tab and reading its DOM. The
 * node has no reason to open a browser just to read a list, so it fetches the
 * same search pages the control plane builds for the user and parses them with
 * the control plane's own regex parser (PORTED from src/lib/apply/boards/jobinja.ts
 * — the one that already ingests Jobinja server-side). Same cards, same ids.
 *
 * Pages are walked newest-first and stop at the first page that reaches past the
 * freshness cutoff, the listing ceiling, or the wall-clock deadline.
 */
import { providerCutoffMs, type DiscoveredListing } from "./types.js";

const JOBINJA_ORIGIN = "https://jobinja.ir";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A safety net only — freshness normally ends the walk long before this. */
const MAX_PAGES = 60;

/** جدول حداقلیِ entityهای HTML که در صفحات جابینجا دیده می‌شوند. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  zwnj: "‌", // نیم‌فاصله — در نام نوع همکاری/شرکت زیاد است.
  laquo: "«",
  raquo: "»",
  hellip: "…",
};

/** entityهای نام‌دار و عددی (ده‌دهی/شانزده‌شانزدهی) را به کاراکتر تبدیل می‌کند. */
function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const named = NAMED_ENTITIES[body];
    return named ?? whole;
  });
}

/** تگ‌ها را حذف، entityها را decode و فاصله‌ها را نرمال می‌کند → متن تمیز. */
function stripTags(html: string): string {
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  // نیم‌فاصله را نگه می‌داریم اما فاصله‌های افقی تکراری را جمع می‌کنیم.
  return decodeEntities(withoutTags)
    .replace(/[\t\r\n ]+/g, " ")
    .replace(/ /g, " ")
    .trim();
}

/** هر URL نسبی/مطلق جابینجا را به URL مطلق و تمیز (بدون پارامترهای ردیابی) تبدیل می‌کند. */
function normalizeUrl(rawHref: string): string | null {
  const href = decodeEntities(rawHref).trim();
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, JOBINJA_ORIGIN);
  } catch {
    return null;
  }
  // پارامترهای ردیابی جابینجا را دور می‌ریزیم تا URL پایدار و canonical بماند.
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * شناسه‌ی کوتاه و پایدار آگهی را از مسیر URL درمی‌آورد:
 * `/companies/{slug}/jobs/{shortId}/...` → `{shortId}` (مثلاً `tO4x`).
 * این پایدارترین منبع externalId است؛ روی همه‌ی کارت‌ها (حتی premium) حاضر است.
 */
function extractShortId(absoluteUrl: string): string | null {
  const match = /\/jobs\/([A-Za-z0-9]+)(?:\/|$)/.exec(absoluteUrl);
  return match?.[1] ?? null;
}

/** اولین گروهِ یک regex را روی متن اجرا و trim‌شده برمی‌گرداند (یا undefined). */
function firstGroup(re: RegExp, source: string): string | undefined {
  const m = re.exec(source);
  if (!m) return undefined;
  const text = stripTags(m[1] ?? "");
  return text.length > 0 ? text : undefined;
}

/* ------------------------------------------------------------------ */
/* پارسرِ خالصِ صفحه‌ی نتایج                                          */
/* ------------------------------------------------------------------ */

/** هر بلوک `<li ... c-jobListView__item ...>...</li>` را جدا می‌کند. */
function sliceCards(html: string): string[] {
  const cards: string[] = [];
  const openRe = /<li[^>]*\bc-jobListView__item\b[^>]*>/g;
  let open: RegExpExecArray | null;
  while ((open = openRe.exec(html)) !== null) {
    const start = open.index;
    // از انتهای تگِ باز، با شمارش <li>/<\/li> تا بسته‌ی متناظر جلو می‌رویم.
    let depth = 1;
    const liToken = /<li\b|<\/li>/g;
    liToken.lastIndex = openRe.lastIndex;
    let end = -1;
    let token: RegExpExecArray | null;
    while ((token = liToken.exec(html)) !== null) {
      if (token[0] === "</li>") {
        depth -= 1;
        if (depth === 0) {
          end = liToken.lastIndex;
          break;
        }
      } else {
        depth += 1;
      }
    }
    if (end === -1) break; // HTML ناقص؛ ادامه نمی‌دهیم.
    cards.push(html.slice(start, end));
    openRe.lastIndex = end; // از کارت بعدی ادامه بده (تو‌درتو نشمار).
  }
  return cards;
}

/** متن «نوع همکاری/حقوق» را به نوع‌همکاری و (در صورت وجود عمومی) حقوق تفکیک می‌کند. */
function parseEmploymentAndSalary(block: string): {
  employment?: string;
  salary?: string;
} {
  // متن داخلی‌ترین <span>ها: اولی نوع همکاری، در صورت وجود حقوقِ عمومی هم می‌آید.
  const innerSpan = /<span>([\s\S]*?)<\/span>/.exec(block);
  const employment = innerSpan ? stripTags(innerSpan[1] ?? "") || undefined : undefined;

  const text = stripTags(block);
  // در نمای خروج‌از‌حساب، حقوق پشت لینک ورود مخفی است → حقوق نداریم.
  if (/برای\s+مشاهده\s+حقوق\s+وارد\s+شوید/.test(text)) {
    return { employment };
  }
  // اگر متنی شامل «حقوق» یا «تومان» (و نه لینک ورود) بود، آن را حقوق می‌گیریم.
  const salaryMatch = /([^<]*?(?:حقوق|تومان)[^<]*)/.exec(
    stripTags(block.replace(/<span>[\s\S]*?<\/span>/, "")),
  );
  const salaryRaw = salaryMatch?.[1]?.trim() ?? "";
  const salary = salaryRaw.length > 0 ? salaryRaw : undefined;
  return { employment, salary };
}

/** عبارت «(۳ روز پیش)» / «(امروز)» را تمیز می‌کند → بدون پرانتز. */
function cleanPostedAt(raw?: string): string | undefined {
  if (!raw) return undefined;
  const inner = /^\(?\s*([\s\S]*?)\s*\)?$/.exec(raw);
  const text = (inner?.[1] ?? raw).trim();
  return text.length > 0 ? text : undefined;
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

function relativePostedDate(raw?: string, now = new Date()): Date | null {
  if (!raw) return null;
  const text = normalizeDigits(raw).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  let days: number | null = null;
  if (/^(امروز|today)$/i.test(text)) days = 0;
  else if (/^(دیروز|yesterday)$/i.test(text)) days = 1;
  else {
    const match = /(\d+)\s*(روز|day|days|هفته|week|weeks|ماه|month|months)\s*(?:پیش|ago)?/i.exec(text);
    if (match) {
      const n = Number(match[1]);
      const unit = match[2] ?? "";
      if (Number.isFinite(n)) {
        if (/روز|day/i.test(unit)) days = n;
        else if (/هفته|week/i.test(unit)) days = n * 7;
        else if (/ماه|month/i.test(unit)) days = n * 30;
      }
    }
  }
  return days === null ? null : new Date(now.getTime() - days * MS_PER_DAY);
}

export function parseListingCard(card: string, now = new Date()): DiscoveredListing | null {
  // عنوان و URL از لینک عنوان درمی‌آید.
  const titleLink =
    /<a[^>]*\bc-jobListView__titleLink\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(card) ??
    /<a[^>]*\bhref="([^"]+)"[^>]*\bc-jobListView__titleLink\b[^>]*>([\s\S]*?)<\/a>/.exec(card);
  if (!titleLink) return null;

  const url = normalizeUrl(titleLink[1] ?? "");
  if (!url) return null;

  const externalId = extractShortId(url);
  if (!externalId) return null;

  const title = stripTags(titleLink[2] ?? "");
  if (!title) return null;

  // شرکت: متنِ اولین metaItem (آیکن construction).
  const company = firstGroup(
    /c-icon--construction[^>]*><\/i>\s*<span>([\s\S]*?)<\/span>/,
    card,
  );

  // شهر: متنِ metaItem با آیکن place.
  const city = firstGroup(/c-icon--place[^>]*><\/i>\s*<span>([\s\S]*?)<\/span>/, card);

  // نوع همکاری + حقوق: metaItem با آیکن resume.
  const resumeBlock = /c-icon--resume[^>]*><\/i>\s*<span>([\s\S]*?)<\/span>\s*<\/li>/.exec(card);
  const { salary } = resumeBlock
    ? parseEmploymentAndSalary(resumeBlock[1] ?? "")
    : { salary: undefined };

  // تاریخ انتشار: «(امروز)» یا «(۳ روز پیش)».
  const postedAt = cleanPostedAt(
    firstGroup(/c-jobListView__passedDays">([\s\S]*?)<\/span>/, card),
  );

  // The ingest requires an ISO timestamp. A card whose age cannot be read is
  // dropped rather than guessed at: calling an unknown posting "fresh" is how old
  // listings end up at the top of the public page and in someone's queue.
  const posted = relativePostedDate(postedAt, now);
  if (!posted) return null;

  return {
    externalId,
    title,
    company: company ?? null,
    city: city ?? null,
    url,
    salary: salary ?? null,
    postedAt: posted.toISOString(),
  };
}


/** PURE: every listing card on one results page, de-duplicated by id. */
export function parseSearchHtml(html: string, now = new Date()): DiscoveredListing[] {
  const seen = new Set<string>();
  const out: DiscoveredListing[] = [];
  for (const card of sliceCards(html)) {
    const listing = parseListingCard(card, now);
    if (!listing || seen.has(listing.externalId)) continue;
    seen.add(listing.externalId);
    out.push(listing);
  }
  return out;
}

/** PURE: the URL of page N of a search, preserving every filter on the first page. */
export function jobinjaPageUrl(firstUrl: string, page: number): string {
  const url = new URL(firstUrl, JOBINJA_ORIGIN);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  return url.toString();
}

/** PURE: does this page say "prove you're human" instead of listing jobs? */
export function looksLikeJobinjaChallenge(html: string): boolean {
  return /checking your browser before accessing|complete the security check|cf-chl-|recaptcha|بررسی امنیتی/i.test(
    html,
  );
}

export interface JobinjaDiscoveryOptions {
  maxAgeDays: number;
  maxListings?: number;
  deadlineAt?: number;
}

/**
 * Walk a Jobinja search (built by the control plane from the user's filters)
 * newest-first until the listings go stale. A security check is a stop, never a
 * retry — it throws so the caller records it and backs off.
 */
export async function discoverJobinjaListings(
  searchUrl: string,
  options: JobinjaDiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<DiscoveredListing[]> {
  const cutoff = providerCutoffMs(options.maxAgeDays, now.getTime());
  const found = new Map<string, DiscoveredListing>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetchImpl(jobinjaPageUrl(searchUrl, page), {
      headers: { accept: "text/html" },
    });
    if (response.status === 429) throw new Error("jobinja_rate_limited: discovery throttled");
    if (!response.ok) throw new Error(`jobinja_discovery_failed: ${response.status}`);
    const html = await response.text();
    if (looksLikeJobinjaChallenge(html)) {
      throw new Error("jobinja_security_check: discovery blocked");
    }

    const listings = parseSearchHtml(html, now);
    if (listings.length === 0) break;

    let reachedPast = false;
    for (const listing of listings) {
      if (Date.parse(listing.postedAt) < cutoff) {
        reachedPast = true;
        continue;
      }
      found.set(listing.externalId, listing);
    }
    if (reachedPast) break;
    if (options.maxListings !== undefined && found.size >= options.maxListings) break;
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
  }

  return [...found.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}
