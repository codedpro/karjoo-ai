/**
 * نگاشتِ خالصِ «دسته‌بندی‌های انتخابیِ کاربر → ترجیحاتِ جست‌وجو/تطبیق» (WF1، Track B).
 *
 * انتخاب‌های کاربر (slugِ دسته‌ها از تاکسونومیِ src/lib/taxonomy) به فیلدهای JobPreferences
 * که موتورِ orchestrator/جست‌وجو مصرف می‌کند، تبدیل می‌شوند:
 *   • `titles`     — برچسب‌های فارسی و انگلیسیِ دسته‌ها (کلیدواژه‌های جست‌وجوی آگهی؛
 *                     orchestrator همین `titles` را به scrapePublic می‌دهد).
 *   • `categories` — slugِ پایدارِ دسته‌ها (مرجعِ داخلیِ فیلتر/تطبیق، مستقل از زبانِ نمایش).
 *
 * این ماژول عمداً خالص است (نه server-only، نه DB/شبکه): هم در UI، هم در route handler،
 * هم در تست استفاده می‌شود. slugِ نامعتبر بی‌سروصدا کنار گذاشته می‌شود (در برابرِ داده‌ی
 * کهنه/دستکاری‌شده مقاوم)، خروجی یکتا و با ترتیبِ تاکسونومی (sortOrder) پایدار می‌ماند.
 */
import {
  JOB_CATEGORY_BY_SLUG,
  JOB_CATEGORY_SEED,
  type CategorySeed,
} from "@/lib/taxonomy/categories";

/**
 * زیرمجموعه‌ی JobPreferences که از علاقه‌مندی‌ها مشتق می‌شود.
 *
 * دسته‌ها به `categorySlugs` در jsonbِ preferences می‌نشینند — همان کلیدی که
 * `parseApplyFilters`/`buildSearchUrl` می‌خوانند و به `filters[job_categories][]` تبدیل می‌کنند.
 */
export interface InterestPreferences {
  /**
   * slugِ پایدارِ دسته‌های انتخابی — همان چیزی که به `filters[job_categories][]` می‌رود.
   *
   * عمداً دیگر `titles` تولید نمی‌شود: برچسبِ نمایشیِ دسته به‌عنوانِ کلیدواژه‌ی جست‌وجو
   * بی‌معناست و در جابینجا صفر نتیجه می‌دهد. هدف‌گیری با «دسته» انجام می‌شود، نه با
   * تبدیلِ نامِ دسته به کلیدواژه.
   */
  categories: string[];
}

/**
 * slugهای انتخابیِ کاربر → InterestPreferences (titles + categories).
 *
 * - فقط slugهای معتبرِ تاکسونومی نگه داشته می‌شوند (نامعتبر کنار می‌رود).
 * - ترتیبِ خروجی با sortOrderِ تاکسونومی پایدار است (نه با ترتیبِ ورودیِ کاربر) تا
 *   preferencesِ ذخیره‌شده قطعی و قابلِ مقایسه بماند.
 * - تکراری‌ها حذف می‌شوند (هم در slug، هم در عنوان‌ها).
 */
export function selectedCategoriesToPreferences(
  selectedSlugs: readonly string[],
): InterestPreferences {
  // مجموعه‌ی یکتا از slugهای معتبر، سپس به ترتیبِ تاکسونومی مرتب می‌شود.
  const valid = new Set<string>();
  for (const slug of selectedSlugs) {
    if (JOB_CATEGORY_BY_SLUG.has(slug)) valid.add(slug);
  }

  const ordered: CategorySeed[] = JOB_CATEGORY_SEED.filter((c) => valid.has(c.slug));

  const categories = ordered.map((c) => c.slug);

  return { categories };
}

/**
 * preferencesِ موجود (jsonbِ ذخیره‌شده) را با علاقه‌مندیِ تازه ادغام می‌کند، بدونِ از
 * دست‌رفتنِ فیلدهای دیگر (cities/minSalary/employmentTypes). فقط `titles` و `categories`
 * را بازنویسی می‌کند — این دو از علاقه‌مندی‌ها مشتق می‌شوند و باید با انتخابِ تازه هم‌سو
 * شوند؛ بقیه دست‌نخورده می‌مانند.
 */
export function mergeInterestPreferences(
  existing: Record<string, unknown> | null | undefined,
  selectedSlugs: readonly string[],
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const { categories } = selectedCategoriesToPreferences(selectedSlugs);
  // `categorySlugs` همان کلیدی است که خواننده‌ی فیلترها و buildSearchUrl واقعاً می‌خوانند
  // (`filters[job_categories][]`). پیش‌تر این‌جا `categories` نوشته می‌شد که هیچ‌کس نمی‌خواند،
  // پس انتخابِ علاقه‌مندی عملاً هیچ فیلتری اعمال نمی‌کرد.
  //
  // و مهم‌تر: `titles` دیگر بازنویسی **نمی‌شود**. پیش‌تر برچسبِ نمایشیِ دسته‌ها
  // («برنامه‌نویسی و توسعهٔ نرم‌افزار») به‌عنوانِ عنوان ذخیره می‌شد و buildSearchUrl همان را
  // به‌عنوانِ `filters[keywords][0]` می‌فرستاد — عبارتی که در جابینجا **هیچ نتیجه‌ای ندارد**.
  // یعنی به‌محضِ انتخابِ علاقه‌مندی، کشفِ شغل بی‌صدا صفر می‌شد (زنده: ingested=0).
  // کلیدواژه‌های جست‌وجو مالِ خودِ کاربر است و دست‌نخورده می‌ماند.
  return { ...base, categorySlugs: categories, categories };
}
