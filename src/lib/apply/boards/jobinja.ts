import "server-only";

import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";
import { KARJOO_USER_AGENT, isAllowed as robotsIsAllowed } from "@/lib/apply/robots";
import { toJobinjaCategorySlug } from "@/lib/apply/boards/jobinja-categories";

/**
 * کانکتور جابینجا (jobinja.ir) — فاز ۱: ingestion عمومی و فقط‌خواندنی.
 *
 * فقط `scrapePublic()` پیاده شده است: صفحه‌ی نتایج جست‌وجوی عمومی جابینجا را می‌خواند،
 * هر آگهی را پارس می‌کند و به `JobListing` نرمال می‌سازد. این مسیر هیچ نشست کاربری
 * لازم ندارد و هیچ ریسک حسابی ندارد (بخش ۹، فاز ۱ سند معماری).
 *
 * `search()` و `apply()` همچنان داربست‌اند و در فازهای بعد (افزونه/ورکر) پیاده می‌شوند.
 *
 * نکته‌ی پارسر: عمداً به کتابخانه‌ی خارجی وابسته نیستیم؛ پارس با regex مقاوم انجام
 * می‌شود تا «یک کانکتور = یک فایل» باقی بماند و وابستگی جدیدی به package.json اضافه نشود.
 * منطق پارس به‌صورت تابع خالص (`parseSearchHtml`) صادر شده تا تست‌ها بدون شبکه روی
 * فیکسچر اجرا شوند.
 */

/** میزبان رسمی جابینجا. همه‌ی URLهای نسبی نسبت به همین مبنا حل می‌شوند. */
const JOBINJA_ORIGIN = "https://jobinja.ir";

/** نقطه‌ی شروع جست‌وجوی آگهی‌ها. */
const JOBINJA_JOBS_URL = `${JOBINJA_ORIGIN}/jobs`;

/**
 * User-Agent برداشت — همان رشته‌ی قابل‌شناساییِ کارجو (KARJOO_USER_AGENT) که هم در
 * هدرِ درخواست و هم در بررسیِ robots.txt استفاده می‌شود، تا تطبیقِ robots دقیقاً با
 * همان UAیی باشد که واقعاً درخواست می‌فرستد (مرورگرمانند + توکنِ KarjooBot).
 */
const BROWSER_USER_AGENT = KARJOO_USER_AGENT;

/** ادب در برداشت: سقف تعداد صفحه، مکث بین صفحه‌ها و مهلت هر درخواست. */
/**
 * صفحه‌های جست‌وجو در هر اجرا. ۳ تا کم بود: هر صفحه ~۲۰ آگهی، یعنی هر دورِ کشف فقط ~۶۰
 * آگهی می‌دید و «تطبیق‌ها» بسیار کم می‌ماند. با مکثِ ادبِ ۱٫۲ ثانیه‌ای، ۸ صفحه ~۱۰ ثانیه
 * طول می‌کشد — پوششِ خیلی بهتر با همان رفتارِ مؤدبانه.
 */
const DEFAULT_MAX_PAGES = 8;

/** بیشینه‌ی کلیدواژه‌هایی که در یک اجرا جست‌وجو می‌شوند (هر کدام تا DEFAULT_MAX_PAGES صفحه). */
const MAX_KEYWORDS_PER_RUN = 4;
const DELAY_BETWEEN_PAGES_MS = 1_200;
const REQUEST_TIMEOUT_MS = 25_000;

/** آپشن‌های داخلی برداشت (برای تست/تنظیم؛ بخشی از قرارداد عمومی نیست). */
export interface ScrapeOptions {
  /** بیشینه‌ی صفحه‌های پیمایش‌شده در این اجرا (پنجره؛ سقفِ ادب). */
  maxPages?: number;
  /**
   * صفحه‌ای که پیمایش از آن آغاز می‌شود (۱-مبنا؛ پیش‌فرض ۱). با مکان‌نمای صفحه‌بندیِ
   * `runFilterApply` تغذیه می‌شود تا اجراهای پیاپی در عمقِ نتایج پیش بروند.
   */
  startPage?: number;
  /**
   * اگر داده شود، به‌محضِ رسیدنِ تعدادِ آگهیِ *یکتا*ی جمع‌آوری‌شده به این عدد، پیمایش
   * می‌ایستد (تا آگهیِ اضافه‌ای فراتر از سقفِ اجرا واکشی/دورریز نشود؛ مکان‌نما دقیقاً
   * به‌اندازه‌ی صفحاتِ مصرف‌شده جلو می‌رود).
   */
  targetCount?: number;
  /** مکث بین صفحه‌ها (میلی‌ثانیه) — برای رعایت ادب. */
  delayMs?: number;
  /** پیاده‌سازی fetch قابل‌تزریق (تست). پیش‌فرض: fetch سراسری. */
  fetchImpl?: typeof fetch;
  /**
   * بررسیِ مجاز بودنِ یک URL طبق robots.txt — قابل‌تزریق برای تست.
   * پیش‌فرض: در مسیرِ واقعی (بدون fetchِ تزریقی)، بررسیِ واقعیِ robots؛ در تست (با
   * fetchِ تزریقی) به‌صورت «همیشه مجاز» تا شبکه/شمارشِ fetch دست‌نخورده بماند.
   */
  isAllowed?: (url: string) => Promise<boolean>;
}

/** نتیجه‌ی برداشتِ صفحه‌بندی‌شده — آگهی‌ها به‌همراه پیشرفتِ صفحه (برای مکان‌نما). */
export interface ScrapeResult {
  /** آگهی‌های یکتای جمع‌آوری‌شده در این اجرا. */
  listings: JobListing[];
  /** تعدادِ صفحه‌هایی که در این اجرا با موفقیت واکشی و پارس شدند. */
  pagesFetched: number;
  /**
   * آیا به انتهای نتایج رسیدیم؟ (صفحه‌ی خالی، تکرارِ کامل، یا منعِ robots) — در این صورت
   * مکان‌نما به صفحه‌ی ۱ بازنشانی می‌شود تا اجرای بعد سرِ فهرست را دوباره اسکن کند.
   * اگر به‌خاطرِ `targetCount` یا سقفِ `maxPages` ایستادیم false است (احتمالاً صفحه‌ی بیشتری هست).
   */
  reachedEnd: boolean;
}

/* ------------------------------------------------------------------ */
/* ابزارهای پارس متن/HTML                                             */
/* ------------------------------------------------------------------ */

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
  return match ? match[1] : null;
}

/** اولین گروهِ یک regex را روی متن اجرا و trim‌شده برمی‌گرداند (یا undefined). */
function firstGroup(re: RegExp, source: string): string | undefined {
  const m = re.exec(source);
  if (!m) return undefined;
  const text = stripTags(m[1]);
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
  const employment = innerSpan ? stripTags(innerSpan[1]) || undefined : undefined;

  const text = stripTags(block);
  // در نمای خروج‌از‌حساب، حقوق پشت لینک ورود مخفی است → حقوق نداریم.
  if (/برای\s+مشاهده\s+حقوق\s+وارد\s+شوید/.test(text)) {
    return { employment };
  }
  // اگر متنی شامل «حقوق» یا «تومان» (و نه لینک ورود) بود، آن را حقوق می‌گیریم.
  const salaryMatch = /([^<]*?(?:حقوق|تومان)[^<]*)/.exec(
    stripTags(block.replace(/<span>[\s\S]*?<\/span>/, "")),
  );
  const salaryRaw = salaryMatch ? salaryMatch[1].trim() : "";
  const salary = salaryRaw.length > 0 ? salaryRaw : undefined;
  return { employment, salary };
}

/** عبارت «(۳ روز پیش)» / «(امروز)» را تمیز می‌کند → بدون پرانتز. */
function cleanPostedAt(raw?: string): string | undefined {
  if (!raw) return undefined;
  const inner = /^\(?\s*([\s\S]*?)\s*\)?$/.exec(raw);
  const text = (inner ? inner[1] : raw).trim();
  return text.length > 0 ? text : undefined;
}

/**
 * یک کارت آگهی را به `JobListing` نرمال می‌کند. اگر کارت معتبر نباشد (بدون
 * لینک/شناسه/عنوان) `null` برمی‌گرداند تا برداشت با خطا متوقف نشود.
 */
export function parseListingCard(card: string): JobListing | null {
  // عنوان و URL از لینک عنوان درمی‌آید.
  const titleLink =
    /<a[^>]*\bc-jobListView__titleLink\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(card) ??
    /<a[^>]*\bhref="([^"]+)"[^>]*\bc-jobListView__titleLink\b[^>]*>([\s\S]*?)<\/a>/.exec(card);
  if (!titleLink) return null;

  const url = normalizeUrl(titleLink[1]);
  if (!url) return null;

  const externalId = extractShortId(url);
  if (!externalId) return null;

  const title = stripTags(titleLink[2]);
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
    ? parseEmploymentAndSalary(resumeBlock[1])
    : { salary: undefined };

  // تاریخ انتشار: «(امروز)» یا «(۳ روز پیش)».
  const postedAt = cleanPostedAt(
    firstGroup(/c-jobListView__passedDays">([\s\S]*?)<\/span>/, card),
  );

  return {
    id: `jobinja:${externalId}`,
    board: "jobinja",
    externalId,
    title,
    ...(company ? { company } : {}),
    ...(city ? { city } : {}),
    url,
    ...(salary ? { salary } : {}),
    ...(postedAt ? { postedAt } : {}),
  };
}

/**
 * کل HTML صفحه‌ی نتایج را پارس می‌کند → آرایه‌ای از `JobListing`، با حذف تکراری‌ها
 * بر اساس `externalId`. تابعِ خالص و بدون شبکه (هسته‌ی قابل‌تست).
 */
export function parseSearchHtml(html: string): JobListing[] {
  const seen = new Set<string>();
  const out: JobListing[] = [];
  for (const card of sliceCards(html)) {
    const listing = parseListingCard(card);
    if (!listing) continue;
    if (seen.has(listing.externalId)) continue;
    seen.add(listing.externalId);
    out.push(listing);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ساختِ URL جست‌وجو از ترجیحات                                       */
/* ------------------------------------------------------------------ */

/**
 * از `JobPreferences` پارامترهای جست‌وجوی جابینجا را می‌سازد:
 *   • `filters[keywords][0]`     ← اولین عنوان شغلی
 *   • `filters[locations][]`     ← شهرها
 *   • صفحه‌بندی با `page`
 * نام دقیق فیلترها مطابق فرم جست‌وجوی جابینجا است (بخش CONTEXT اسکفولد).
 */
export function buildSearchUrl(
  prefs: JobPreferences,
  page: number,
  /** کلیدواژه‌ی صریح (برای پیمایشِ چند کلیدواژه). نبود ⇒ اولین عنوانِ ترجیحات. */
  keywordOverride?: string,
): string {
  const url = new URL(JOBINJA_JOBS_URL);
  const params = url.searchParams;

  const keyword =
    keywordOverride?.trim() || prefs.titles?.find((t) => t && t.trim().length > 0)?.trim();
  if (keyword) {
    params.append("filters[keywords][0]", keyword);
  }
  for (const city of prefs.cities ?? []) {
    if (city && city.trim().length > 0) {
      params.append("filters[locations][]", city.trim());
    }
  }
  // CATEGORY-based targeting (the primary, non-AI flow): each chosen category slug
  // becomes a Jobinja `filters[job_categories][]`, so the search returns every job
  // in those categories to apply to.
  // دسته‌ها باید **slugِ واقعیِ جابینجا** باشند. slugِ داخلیِ ما («software-development»)
  // برای جابینجا ناشناخته است و نتیجه را به صفر می‌رساند — پس ترجمه می‌کنیم و هرچه
  // ناشناخته ماند حذف می‌شود (بدترین حالت: جست‌وجوی کلیدواژه‌ای، نه صفرِ خاموش).
  const seenCats = new Set<string>();
  for (const cat of prefs.categorySlugs ?? []) {
    const mapped = cat ? toJobinjaCategorySlug(cat) : null;
    if (mapped && !seenCats.has(mapped)) {
      seenCats.add(mapped);
      params.append("filters[job_categories][]", mapped);
    }
  }
  for (const jt of prefs.jobTypes ?? []) {
    if (jt && jt.trim().length > 0) {
      params.append("filters[job_types][]", jt.trim());
    }
  }
  if (prefs.remoteOnly) {
    params.set("filters[remote]", "1");
  }
  if (typeof prefs.minSalary === "number" && prefs.minSalary > 0) {
    params.set("filters[sal_min]", String(prefs.minSalary));
  }
  if (prefs.sort && prefs.sort.trim().length > 0) {
    params.set("sort", prefs.sort.trim());
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  url.search = params.toString();
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* مکث ساده (برای رعایت ادب بین صفحه‌ها)                              */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* کانکتور                                                            */
/* ------------------------------------------------------------------ */

export const jobinja: JobBoardConnector & {
  scrapePublicWith(prefs: JobPreferences, opts: ScrapeOptions): Promise<ScrapeResult>;
} = {
  id: "jobinja",
  displayName: "جابینجا",
  applyType: "structured",
  sessionShape: "cookie",

  async scrapePublic(prefs: JobPreferences): Promise<JobListing[]> {
    return (await this.scrapePublicWith(prefs, {})).listings;
  },

  /**
   * نسخه‌ی قابل‌تنظیمِ `scrapePublic` با تزریق fetch/پنجره‌ی صفحه (برای تست و orchestrator).
   * بخشی از قرارداد عمومی کانکتور نیست؛ صرفاً افزونه‌ی این پیاده‌سازی است. `ScrapeResult`
   * علاوه بر آگهی‌ها، پیشرفتِ صفحه را برمی‌گرداند تا orchestrator مکان‌نما را جلو ببرد.
   */
  async scrapePublicWith(prefs: JobPreferences, opts: ScrapeOptions): Promise<ScrapeResult> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const maxPages = Math.max(1, opts.maxPages ?? DEFAULT_MAX_PAGES);
    const startPage = Math.max(1, Math.floor(opts.startPage ?? 1));
    const endPage = startPage + maxPages - 1;
    const targetCount =
      typeof opts.targetCount === "number" && opts.targetCount > 0
        ? opts.targetCount
        : Number.POSITIVE_INFINITY;
    const delayMs = opts.delayMs ?? DELAY_BETWEEN_PAGES_MS;

    // بررسیِ robots: اگر صریحاً تزریق شده از همان؛ وگرنه در مسیرِ واقعی (fetchِ پیش‌فرض)
    // بررسیِ واقعیِ robots با همان UA؛ در تست (fetchِ تزریقی) «همیشه مجاز» تا شبکه/شمارش
    // fetch دست‌نخورده بماند.
    const checkAllowed =
      opts.isAllowed ??
      (opts.fetchImpl
        ? async () => true
        : (url: string) => robotsIsAllowed(url, BROWSER_USER_AGENT));

    const collected: JobListing[] = [];
    const seen = new Set<string>();
    let pagesFetched = 0;
    let reachedEnd = false;

    // چند کلیدواژه، نه فقط اولی. جابینجا چند `filters[keywords][i]` را **و**-گونه ترکیب
    // می‌کند (نتیجه را باریک‌تر می‌کند)، پس برای پوششِ بیشتر باید هر کلیدواژه را جداگانه
    // جست‌وجو کرد. پیش‌تر فقط titles[0] استفاده می‌شد — یعنی کاربری با ۸ کلیدواژه، ۷ تای
    // آن‌ها را هرگز نمی‌دید.
    const keywords = (prefs.titles ?? [])
      .map((t) => (t ?? "").trim())
      .filter((t) => t.length > 0)
      .slice(0, MAX_KEYWORDS_PER_RUN);
    const keywordList = keywords.length > 0 ? keywords : [undefined];

    for (let ki = 0; ki < keywordList.length; ki += 1) {
      const keyword = keywordList[ki];
    for (let page = startPage; page <= endPage; page += 1) {
      if (page > startPage) {
        await sleep(delayMs); // ادب: مکث بین صفحه‌ها (نه قبل از اولین درخواست).
      }

      const target = buildSearchUrl(prefs, page, keyword);

      // ادب: پیش از واکشی، robots.txt را احترام بگذار. اگر این مسیر disallow باشد،
      // مودبانه رد می‌شویم و آن را «انتها» می‌شماریم (مکان‌نما به ۱ بازنشانی می‌شود).
      const allowed = await checkAllowed(target);
      if (!allowed) {
        console.warn(`[jobinja] robots.txt واکشیِ ${target} را منع کرد — رد شد.`);
        reachedEnd = true;
        break;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let html: string;
      try {
        const res = await fetchImpl(target, {
          method: "GET",
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        if (!res.ok) {
          throw new Error(`jobinja.scrapePublic: HTTP ${res.status} روی ${target}`);
        }
        html = await res.text();
      } finally {
        clearTimeout(timer);
      }

      pagesFetched += 1;

      const pageListings = parseSearchHtml(html);
      if (pageListings.length === 0) {
        reachedEnd = true; // صفحه‌ی خالی یا انتهای نتایج.
        break;
      }

      let added = 0;
      for (const listing of pageListings) {
        if (seen.has(listing.externalId)) continue;
        seen.add(listing.externalId);
        collected.push(listing);
        added += 1;
      }
      // اگر این صفحه هیچ آگهی تازه‌ای نداشت، احتمالاً به تکرار/انتها رسیده‌ایم.
      if (added === 0) {
        reachedEnd = true;
        break;
      }
      // به سهمیه‌ی این اجرا رسیدیم → بایست (انتها نیست؛ مکان‌نما پس از این صفحات ادامه می‌یابد).
      if (collected.length >= targetCount) break;
    }
      // سهمیه پر شد → سراغِ کلیدواژه‌ی بعدی هم نرو.
      if (collected.length >= targetCount) break;
      // هر کلیدواژه فهرستِ خودش را دارد؛ «انتهای» یکی به معنیِ انتهای همه نیست — مگر
      // این‌که آخرینش باشد (آن‌وقت واقعاً تمام شده و مکان‌نما باید به ۱ برگردد).
      if (ki < keywordList.length - 1) reachedEnd = false;
    }

    return { listings: collected, pagesFetched, reachedEnd };
  },

  async search(_prefs: JobPreferences): Promise<JobListing[]> {
    // جست‌وجوی احرازهویت‌شده در فاز افزونه/ورکر پیاده می‌شود.
    throw new Error("jobinja.search: not implemented yet");
  },

  async apply(
    _job: JobListing,
    _profile: CandidateProfile,
    _coverLetter: string,
  ): Promise<ApplicationResult> {
    // ارسال درخواستِ احرازهویت‌شده در فاز افزونه/ورکر پیاده می‌شود.
    throw new Error("jobinja.apply: not implemented yet");
  },
};

/* ------------------------------------------------------------------ */
/* شرحِ کاملِ آگهی (JD) — از صفحه‌ی خودِ آگهی                          */
/* ------------------------------------------------------------------ */

/**
 * شرحِ کاملِ یک آگهی را از صفحه‌ی خودش می‌گیرد.
 *
 * چرا لازم است: کارتِ نتایجِ جست‌وجو **شرحِ شغل را ندارد** — فقط عنوان/شرکت/شهر. تا امروز
 * هیچ‌جا JD ذخیره نمی‌شد (زنده تأیید شد: ۱۳۸ آگهی، صفر توضیحات)، یعنی «رزومه‌ی سفارشیِ هر
 * آگهی» عملاً فقط از روی *عنوان* ساخته می‌شد و نمی‌توانست واقعاً منطبق بر نیازِ آگهی باشد.
 * همین متن، مودالِ «شرحِ شغل» در بایگانی را هم پُر می‌کند.
 *
 * ادب: همان UA و همان بررسیِ robots مثلِ بقیه‌ی مسیرهای این کانکتور؛ خطا → null (هرگز throw).
 */
export async function fetchJobDescription(
  url: string,
  opts: { fetchImpl?: typeof fetch; isAllowed?: (u: string) => Promise<boolean> } = {},
): Promise<string | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const allowed = opts.isAllowed ?? ((u: string) => robotsIsAllowed(u, BROWSER_USER_AGENT));
  try {
    if (!(await allowed(url))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let html: string;
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": BROWSER_USER_AGENT, "Accept-Language": "fa-IR" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) return null;
      html = await res.text();
    } finally {
      clearTimeout(timer);
    }

    return extractJobDescription(html);
  } catch {
    return null;
  }
}

/**
 * متنِ شرحِ آگهی را از HTMLِ صفحه بیرون می‌کشد. جابینجا بخشِ اصلی را زیرِ تیترِ
 * «شرح موقعیت شغلی» می‌گذارد؛ اگر آن الگو عوض شد، به بلاکِ محتوای آگهی برمی‌گردیم.
 * خروجی متنِ ساده (بدون تگ) و کوتاه‌شده تا حدِ منطقی برای پرامپت/نمایش.
 */
export function extractJobDescription(html: string): string | null {
  const MAX = 6000;

  // ۱) از تیترِ «شرح موقعیت شغلی» تا تیترِ بعدی.
  const bySection =
    /شرح\s*موقعیت\s*شغلی[\s\S]{0,200}?<\/h[1-6]>([\s\S]*?)(?:<h[1-6]|<footer|معرفی\s*شرکت|مهارت‌های\s*مورد\s*نیاز)/i.exec(
      html,
    );
  const raw =
    bySection?.[1] ??
    /<div[^>]*\bc-jobView__content\b[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html)?.[1] ??
    null;
  if (!raw) return null;

  const text = stripTags(raw).replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 30) return null;
  return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
}
