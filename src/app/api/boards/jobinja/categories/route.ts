import "server-only";

/**
 * GET /api/boards/jobinja/categories — دسته‌بندی‌های شغلیِ جابینجا (عمومی، کش‌شده).
 *
 * منبعِ داده: getJobinjaCategories (src/lib/apply/boards/jobinja-categories.ts) که
 * اندپوینتِ عمومیِ جابینجا را می‌آورد، نرمال می‌کند و در برابرِ خطا مقاوم است (کشِ کهنه
 * یا لیستِ داخلی؛ هرگز throw). این روت هرگز ۵۰۰ نمی‌دهد.
 *
 * پاسخ: { count, source, categories: [{ slug, name, englishName }] }
 *   • `slug` همان machine_nameِ جابینجاست — همان مقداری که در filters[job_categories][]
 *     می‌رود. Track A (پیکرِ فیلترها) این لیست را به‌صورتِ چک‌لیستِ قابلِ جست‌وجو نشان می‌دهد.
 *
 * عمومی است (بدونِ نشست/راز): فقط متادیتای عمومیِ دسته‌ها را برمی‌گرداند و کش‌پذیر است تا
 * بارِ سرور/جابینجا کم بماند (دسته‌ها به‌ندرت عوض می‌شوند).
 */
import { json, withErrorHandling } from "@/lib/api/http";
import {
  getJobinjaCategories,
  type CategorySource,
  type JobinjaCategory,
} from "@/lib/apply/boards/jobinja-categories";

// شبکه (fetch به جابینجا) → اجرای Node لازم است.
export const runtime = "nodejs";

/** شکلِ پاسخِ عمومیِ دسته‌بندی‌ها. */
export interface JobinjaCategoriesResponse {
  count: number;
  /** منبعِ داده: live | cache | fallback (شفافیت/دیباگ). */
  source: CategorySource;
  categories: JobinjaCategory[];
}

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const { categories, source } = await getJobinjaCategories();

    const body: JobinjaCategoriesResponse = {
      count: categories.length,
      source,
      categories,
    };

    const res = json(body);
    // دسته‌ها به‌ندرت عوض می‌شوند؛ کشِ عمومیِ کوتاه + سروِ کهنه هنگامِ بازاعتبارسنجی تا
    // کلاینت‌ها/CDN سرور را نکوبند. عمومی است چون هیچ داده‌ی کاربری/رازی ندارد.
    // اگر fallback برگشت (جابینجا در دسترس نبود)، کشِ کوتاه‌تر تا زودتر دوباره تلاش شود.
    res.headers.set(
      "Cache-Control",
      source === "fallback"
        ? "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
        : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res;
  });
}
