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
 * `categories` در نوعِ پایه‌ی JobPreferences (types.ts) نیست؛ اینجا به‌عنوان فیلدِ افزوده‌ی
 * ذخیره‌شده در jsonbِ preferences نگه‌داری می‌شود تا تطبیقِ سمتِ ما بتواند به دسته (نه فقط
 * عنوان) تکیه کند. orchestrator فعلاً `titles` را می‌خواند؛ `categories` برای فیلترِ آینده.
 */
export interface InterestPreferences {
  /** کلیدواژه‌های جست‌وجو — برچسبِ فارسی و انگلیسیِ هر دسته (مصرفِ scrapePublic). */
  titles: string[];
  /** slugِ پایدارِ دسته‌های انتخابی (مرجعِ داخلیِ فیلتر/تطبیق). */
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

  // عنوان‌ها: برچسبِ فارسی و انگلیسیِ هر دسته، یکتا (با حفظِ ترتیبِ تاکسونومی).
  const titlesSet = new Set<string>();
  for (const c of ordered) {
    titlesSet.add(c.labelFa);
    titlesSet.add(c.labelEn);
  }

  return { titles: [...titlesSet], categories };
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
  const { titles, categories } = selectedCategoriesToPreferences(selectedSlugs);
  return { ...base, titles, categories };
}
