import "server-only";

/**
 * منبعِ «دسته‌بندی‌های شغلیِ جابینجا» برای فیلترِ اپلای (Foundation).
 *
 * جابینجا یک اندپوینتِ عمومیِ بدونِ احراز دارد که ~۴۸ دسته را برمی‌گرداند:
 *   GET https://jobinja.ir/api/v10/job/categories
 *   → [{ id, machine_name, name (fa), english_name, ... }]
 *
 * مقدارِ فیلتر در URLِ جست‌وجو همان `machine_name` است (اسلاگ) که
 * buildSearchUrl آن را به `filters[job_categories][]=<slug>` تبدیل می‌کند. این ماژول
 * لیست را می‌آورد، به شکلِ سبکِ { slug, name, englishName } نرمال می‌کند و «مقاوم»
 * است: در صورتِ هر خطای شبکه/پارس، آخرین کشِ موفق یا یک لیستِ داخلیِ کوچک را برمی‌گرداند
 * و هرگز throw نمی‌کند (روت هرگز ۵۰۰ نمی‌دهد).
 *
 * منطقِ پارس/کش عمداً از روتِ HTTP جدا شده تا خالص و قابلِ تست بماند (fetch و store
 * تزریق‌پذیرند). Track A (پیکرِ فیلترها) این را از طریقِ روتِ کش‌شده مصرف می‌کند.
 */

/** یک دسته‌ی جابینجا به شکلِ سبک برای مصرفِ UI/فیلتر. */
export interface JobinjaCategory {
  /** `machine_name` جابینجا — همان مقداری که در filters[job_categories][] می‌رود. */
  slug: string;
  /** نامِ فارسیِ دسته (برای نمایش). */
  name: string;
  /** نامِ انگلیسیِ دسته (ممکن است خالی باشد). */
  englishName: string;
}

/** اندپوینتِ عمومیِ دسته‌بندی‌های جابینجا. */
const JOBINJA_CATEGORIES_URL = "https://jobinja.ir/api/v10/job/categories";

/** طولِ عمرِ کشِ درون‌حافظه‌ای (پیش‌فرض ۶ ساعت). */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** مهلتِ هر درخواستِ واکشی (ادب + جلوگیری از هنگ). */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * لیستِ داخلیِ fallback — زیرمجموعه‌ی واقعیِ دسته‌های پرکاربردِ جابینجا (اسلاگ‌های واقعی
 * از machine_name). فقط وقتی استفاده می‌شود که واکشیِ زنده شکست بخورد و کشِ موفقی هم
 * نباشد؛ پس همیشه فیلترِ معتبر می‌سازد (اسلاگ‌ها با URLِ واقعیِ جابینجا هم‌خوان‌اند).
 */
export const FALLBACK_CATEGORIES: JobinjaCategory[] = [
  { slug: "وب،‌-برنامه‌نویسی-و-نرم‌افزار", name: "وب،‌ برنامه‌نویسی و نرم‌افزار", englishName: "web, software development" },
  { slug: "iT--DevOps--Server", name: "IT / DevOps / Server", englishName: "IT / DevOps / Server" },
  { slug: "مهندسی-برق-و-الکترونیک", name: "مهندسی برق و الکترونیک", englishName: "Electrical and Electronic Engineering" },
  { slug: "فروش-و-بازاریابی", name: "فروش و بازاریابی", englishName: "Sales and Marketing" },
  { slug: "دیجیتال-مارکتینگ", name: "دیجیتال مارکتینگ", englishName: "" },
  { slug: "مالی-و-حسابداری", name: "مالی و حسابداری", englishName: "financial and accounting" },
  { slug: "پشتیبانی-و-امور-مشتریان", name: "پشتیبانی و امور مشتریان", englishName: "support and Customer service" },
  { slug: "تولید-و-مدیریت-محتوا", name: "تولید و مدیریت محتوا", englishName: "Content production and management" },
  { slug: "طراحی", name: "طراحی", englishName: "Designing" },
  { slug: "مدیر-محصول", name: "مدیر محصول", englishName: "Product manager" },
  { slug: "منابع-انسانی-و-کارگزینی", name: "منابع انسانی و کارگزینی", englishName: "Human resources and recruitment" },
  { slug: "مسئول-دفتر،-اجرائی-و-اداری", name: "مسئول دفتر، اجرائی و اداری", englishName: "Office assistant, executive and administrative" },
  { slug: "خرید-و-بازرگانی", name: "خرید و بازرگانی", englishName: "supply change managment" },
  { slug: "مهندسی-صنایع-و-مدیریت-صنعتی", name: "مهندسی صنایع و مدیریت صنعتی", englishName: "Industrial engineering and industrial management" },
  { slug: "مهندسی-مکانیک-و-هوافضا", name: "مهندسی مکانیک و هوافضا", englishName: "Mechanical and aerospace engineering" },
  { slug: "مهندسی-عمران-و-معماری", name: "مهندسی عمران و معماری", englishName: "Civil engineering and architecture" },
  { slug: "پزشکی،‌-پرستاری-و-دارویی", name: "پزشکی،‌ پرستاری و دارویی", englishName: "medical, nursing, pharmaceutical" },
  { slug: "آموزش", name: "آموزش", englishName: "learning and training" },
  { slug: "ترجمه", name: "ترجمه", englishName: "Translation" },
  { slug: "حمل-و-نقل", name: "حمل و نقل", englishName: "transport" },
];

/** منبعِ داده‌ی برگشتی — برای شفافیت/دیباگ در پاسخِ روت. */
export type CategorySource = "live" | "cache" | "fallback";

/** کشِ درون‌حافظه‌ایِ تزریق‌پذیر (تا تست‌ها ایزوله بمانند). */
export interface CategoryCacheStore {
  value: { at: number; data: JobinjaCategory[] } | null;
}

/** کشِ پیش‌فرضِ سطحِ ماژول (بینِ درخواست‌ها روی همان پروسه به اشتراک می‌ماند). */
const moduleStore: CategoryCacheStore = { value: null };

/**
 * یک آیتمِ خامِ API را به JobinjaCategory نرمال می‌کند یا null (آیتمِ نامعتبر).
 * فقط به `machine_name` (اسلاگ) و `name` نیاز داریم؛ english_name اختیاری است.
 */
function mapRawCategory(raw: unknown): JobinjaCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = typeof r.machine_name === "string" ? r.machine_name.trim() : "";
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!slug || !name) return null;
  const englishNameRaw = typeof r.english_name === "string" ? r.english_name : "";
  // english_name گاهی newline/فاصله‌ی اضافه دارد → تمیز می‌کنیم.
  const englishName = englishNameRaw.replace(/\s+/g, " ").trim();
  return { slug, name, englishName };
}

/**
 * بدنه‌ی خامِ API (آرایه) را به لیستِ نرمال و بدونِ تکرارِ اسلاگ تبدیل می‌کند.
 * تابعِ خالص (بدونِ شبکه) — هسته‌ی قابلِ تست.
 */
export function mapRawCategories(raw: unknown): JobinjaCategory[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: JobinjaCategory[] = [];
  for (const item of raw) {
    const mapped = mapRawCategory(item);
    if (!mapped) continue;
    if (seen.has(mapped.slug)) continue;
    seen.add(mapped.slug);
    out.push(mapped);
  }
  return out;
}

/** آپشن‌های getJobinjaCategories — همه تزریق‌پذیر برای تست. */
export interface GetCategoriesOptions {
  /** پیاده‌سازیِ fetch (پیش‌فرض fetchِ سراسری). */
  fetchImpl?: typeof fetch;
  /** طولِ عمرِ کش (میلی‌ثانیه). پیش‌فرض ۶ ساعت. */
  ttlMs?: number;
  /** زمانِ فعلی (میلی‌ثانیه) — برای تستِ قطعیِ کش. */
  now?: number;
  /** نادیده‌گرفتنِ کش و واکشیِ تازه. */
  force?: boolean;
  /** کشِ تزریقی (پیش‌فرض کشِ سطحِ ماژول). */
  store?: CategoryCacheStore;
  /** مهلتِ واکشی (میلی‌ثانیه). پیش‌فرض ۸ ثانیه. */
  timeoutMs?: number;
}

/** خروجیِ getJobinjaCategories — لیست + منبع + سنِ داده. */
export interface GetCategoriesResult {
  categories: JobinjaCategory[];
  source: CategorySource;
  /** سنِ دادهٔ برگشتی به میلی‌ثانیه (۰ برای live/fallback). */
  ageMs: number;
}

/**
 * دسته‌بندی‌های جابینجا را برمی‌گرداند — کش‌شده و مقاوم.
 *
 * ترتیب:
 *   ۱) اگر کشِ تازه (زیرِ ttl) هست و force نشده → از کش.
 *   ۲) وگرنه واکشیِ زنده؛ موفق → کش را به‌روزرسانی و برگردان.
 *   ۳) خطا/پاسخِ خالی → اگر کشِ قبلی (کهنه) هست همان؛ وگرنه FALLBACK.
 *
 * هرگز throw نمی‌کند.
 */
export async function getJobinjaCategories(
  opts: GetCategoriesOptions = {},
): Promise<GetCategoriesResult> {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const store = opts.store ?? moduleStore;

  if (!opts.force && store.value && now - store.value.at < ttl) {
    return { categories: store.value.data, source: "cache", ageMs: now - store.value.at };
  }

  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let raw: unknown;
    try {
      const res = await fetchImpl(JOBINJA_CATEGORIES_URL, {
        method: "GET",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      raw = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const mapped = mapRawCategories(raw);
    if (mapped.length === 0) {
      throw new Error("empty category list");
    }
    store.value = { at: now, data: mapped };
    return { categories: mapped, source: "live", ageMs: 0 };
  } catch (err) {
    console.warn(
      `[jobinja-categories] واکشیِ دسته‌بندی‌ها ناموفق بود — از ${
        store.value ? "کشِ کهنه" : "لیستِ داخلی"
      } استفاده می‌شود:`,
      err instanceof Error ? err.message : err,
    );
    if (store.value) {
      return { categories: store.value.data, source: "cache", ageMs: now - store.value.at };
    }
    return { categories: FALLBACK_CATEGORIES, source: "fallback", ageMs: 0 };
  }
}
