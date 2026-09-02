import type { BrowserDiscoveredListing } from "@ext/lib/types";
import { providerCutoffMs } from "@ext/lib/freshness";

const ORIGIN = "https://karboom.io";

/**
 * کشفِ آگهی در کاربوم.
 *
 * کاربوم برخلافِ ایران‌تلنت API ندارد و صفحه‌ها را سمتِ سرور رندر می‌کند، پس
 * کارت‌ها از خودِ HTML خوانده می‌شوند. مهم‌تر این‌که **هر نشانی فقط یک وجهِ مسیری**
 * می‌پذیرد: `/jobs/{دسته}` یا `/jobs/{نوعِ همکاری}` — نه هر دو. تنها فیلترِ واقعیِ
 * پارامتری `address_city_id[]` است که روی مسیرِ دسته سوار می‌شود. برای همین وقتی
 * هم دسته و هم نوعِ همکاری خواسته شده، دو مجموعه جداگانه گرفته و **اشتراک** گرفته
 * می‌شود؛ این تنها راهِ درستِ ترکیبِ این دو در کاربوم است.
 */
interface DiscoveryOptions {
  /** مسیرهای دسته، مثلِ `programming-and-software`. */
  categoryKeys: string[];
  /** شناسه‌های عددیِ شهر برای `address_city_id[]`. */
  cities: string[];
  /** مسیرهای نوعِ همکاری، مثلِ `full-time`. */
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  maxAgeDays: number;
  deadlineAt?: number;
  maxListings?: number;
}

/**
 * نامِ شهر → شناسه‌ی عددیِ کاربوم، از خودِ `select.js-select-city` در صفحه‌ی /jobs.
 *
 * لازم است چون تنها فیلترِ واقعیِ کاربوم `address_city_id[]` است و **عدد** می‌خواهد؛
 * اگر نامِ فارسی بفرستیم کاربوم بی‌صدا نادیده‌اش می‌گیرد و نتیجه فیلترنشده برمی‌گردد —
 * همان دسته خطایی که یک‌بار با `sort` جابینجا رخ داد. کاربر در داشبورد نامِ شهر
 * می‌نویسد، پس ترجمه این‌جا انجام می‌شود.
 */
const CITY_IDS: Record<string, string> = {
  "تهران": "87", "مشهد": "130", "اصفهان": "45", "کرج": "66", "شیراز": "194",
  "اهواز": "142", "قم": "211", "قزوین": "210", "تبریز": "6", "ساوه": "405",
  "البرز": "207", "رشت": "271", "هشتگرد": "446", "آمل": "382", "بابل": "383",
  "کمال شهر": "445", "بوئین زهرا": "208", "پردیس": "438", "مرودشت": "202",
  "یزد": "437", "پاکدشت": "86", "کهریزک": "443", "کرمان": "233", "کردان": "444",
  "ورامین": "94", "ساری": "390", "اراک": "400", "رباط کریم": "89", "شهریار": "92",
  "گرگان": "264", "سلمان شهر": "449", "دزفول": "148", "بهشهر": "385",
  "شوشتر": "154", "ابهر": "159", "نور": "396", "زنجان": "163", "اسکو": "2",
  "گرمسار": "169", "زرندیه": "404", "بندرعباس": "409", "کاشان": "58",
  "بوشهر": "76", "کیش": "440",
};

/**
 * PURE: هرچه کاربر نوشته → شناسه‌های عددی. عددها همان‌طور می‌مانند، نام‌ها ترجمه
 * می‌شوند، و نامِ ناشناخته حذف می‌شود (فرستادنش فیلتر را بی‌اثر می‌کرد).
 */
export function resolveKarboomCityIds(cities: string[]): string[] {
  const ids = new Set<string>();
  for (const raw of cities) {
    const value = raw.trim();
    if (!value) continue;
    if (/^\d+$/.test(value)) { ids.add(value); continue; }
    const mapped = CITY_IDS[value.replace(/\s+/g, " ")];
    if (mapped) ids.add(mapped);
  }
  return [...ids];
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = PERSIAN_DIGITS.indexOf(d);
    return String(fa >= 0 ? fa : ARABIC_DIGITS.indexOf(d));
  });
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const UNIT_MS: Record<string, number> = {
  "دقیقه": 60_000,
  "ساعت": 3_600_000,
  "روز": 86_400_000,
  "هفته": 604_800_000,
  "ماه": 2_592_000_000,
  "سال": 31_536_000_000,
};

/**
 * PURE: «۲ روز قبل» → زمانِ تقریبی. کاربوم تاریخِ دقیق نمی‌دهد و فقط فاصله‌ی
 * گِرد‌شده را نشان می‌دهد، پس این عدد تقریبی است — برای سقفِ تازگی کافی است.
 */
export function parseRelativePersianDate(raw: string, now: number): number | null {
  const text = toLatinDigits(decodeEntities(raw));
  if (/لحظات|هم\s*اکنون|هم‌اکنون/.test(text)) return now;
  if (/^امروز/.test(text)) return now;
  if (/^دیروز/.test(text)) return now - UNIT_MS["روز"]!;
  const match = /(\d{1,3})\s*(دقیقه|ساعت|روز|هفته|ماه|سال)/.exec(text);
  if (!match) return null;
  const unit = UNIT_MS[match[2]!];
  if (!unit) return null;
  return now - Number(match[1]) * unit;
}

function attribute(block: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(block);
  return match ? decodeEntities(match[1]!) : undefined;
}

function firstText(block: string, className: string): string | undefined {
  const match = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>\\s*([^<]{1,160})`).exec(block);
  const value = match ? decodeEntities(match[1]!) : undefined;
  return value || undefined;
}

/** کاربوم عنوان‌ها را با «استخدام » شروع می‌کند؛ آن پیشوند بخشی از عنوانِ شغل نیست. */
function cleanTitle(raw: string): string {
  return raw.replace(/^استخدام\s+/, "").trim();
}

/** PURE: یک کارتِ HTML → آگهی. */
export function parseKarboomCard(block: string, now: number): BrowserDiscoveredListing | null {
  const href = attribute(block, "data-href") ?? attribute(block, "href");
  const detailUrl = attribute(block, "data-url");
  const code = /\/jobs\/details\/([A-Za-z0-9_-]+)/.exec(detailUrl ?? "")?.[1]
    ?? /\/jobs\/([A-Za-z0-9_-]+)\//.exec(href ?? "")?.[1];
  const title = attribute(block, "title");
  if (!code || !href || !title) return null;
  const postedMs = parseRelativePersianDate(firstText(block, "date") ?? "", now);
  if (postedMs === null) return null;
  return {
    externalId: code,
    title: cleanTitle(title),
    company: firstText(block, "company-name") ?? null,
    city: firstText(block, "pull-right") ?? null,
    url: href,
    description: null,
    salary: null,
    postedAt: new Date(postedMs).toISOString(),
    gender: null,
    alreadyApplied: false,
  };
}

/** PURE: یک صفحه‌ی نتایج → آگهی‌ها. */
export function parseKarboomPage(html: string, now: number): BrowserDiscoveredListing[] {
  const listings: BrowserDiscoveredListing[] = [];
  const parts = html.split("js-job-position-card");
  for (let index = 1; index < parts.length; index += 1) {
    const listing = parseKarboomCard(parts[index]!.slice(0, 3000), now);
    if (listing) listings.push(listing);
  }
  return listings;
}

function pageUrl(facet: string, cities: string[], page: number): string {
  const url = new URL(facet ? `${ORIGIN}/jobs/${encodeURIComponent(facet)}` : `${ORIGIN}/jobs`);
  for (const city of cities) url.searchParams.append("address_city_id[]", city);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

async function collectFacet(
  facet: string,
  options: DiscoveryOptions,
  cutoff: number,
  now: number,
  fetchImpl: typeof fetch,
  found: Map<string, BrowserDiscoveredListing>,
  onPage?: (count: number) => Promise<void> | void,
): Promise<void> {
  for (let page = 1; ; page += 1) {
    const response = await fetchImpl(pageUrl(facet, options.cities, page), {
      headers: { accept: "text/html" },
      credentials: "include",
    });
    if (response.status === 429) throw new Error("karboom_rate_limited: discovery throttled");
    if (!response.ok) throw new Error(`karboom_discovery_failed: ${response.status}`);
    const listings = parseKarboomPage(await response.text(), now);
    if (listings.length === 0) break;
    let oldest = Number.POSITIVE_INFINITY;
    for (const listing of listings) {
      const time = Date.parse(listing.postedAt);
      oldest = Math.min(oldest, time);
      if (time >= cutoff) found.set(listing.externalId, listing);
    }
    await onPage?.(found.size);
    if (oldest < cutoff) break;
    if (options.maxListings !== undefined && found.size >= options.maxListings) break;
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
  }
}

export async function discoverKarboomListings(
  options: DiscoveryOptions,
  fetchImpl: typeof fetch = fetch,
  onPage?: (count: number) => Promise<void> | void,
  now: number = Date.now(),
): Promise<BrowserDiscoveredListing[]> {
  const cutoff = providerCutoffMs(options.maxAgeDays);
  const cityIds = resolveKarboomCityIds(options.cities);
  const scoped: DiscoveryOptions = { ...options, cities: cityIds };
  const categories = options.categoryKeys.length > 0 ? options.categoryKeys : [""];
  const types = [...options.employmentTypeKeys];
  if (options.remoteOnly && !types.includes("remote")) types.push("remote");

  const byCategory = new Map<string, BrowserDiscoveredListing>();
  for (const category of categories) {
    await collectFacet(category, scoped, cutoff, now, fetchImpl, byCategory, onPage);
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
  }

  let selected = byCategory;
  if (types.length > 0) {
    const byType = new Map<string, BrowserDiscoveredListing>();
    for (const type of types) {
      await collectFacet(type, scoped, cutoff, now, fetchImpl, byType, onPage);
      if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) break;
    }
    // اشتراک، چون کاربوم اجازه‌ی ترکیبِ دو وجهِ مسیری را در یک نشانی نمی‌دهد.
    selected = new Map([...byCategory].filter(([id]) => byType.has(id)));
  }

  return [...selected.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}
