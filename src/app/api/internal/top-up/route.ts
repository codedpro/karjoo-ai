import "server-only";

/**
 * POST /api/internal/top-up
 *
 * یک دورِ «کشفِ سطحِ سرور» را تریگر می‌کند: صفِ اپلایِ خودکارِ سرور را برای همه‌ی کاربرانِ
 * واجدِ شرایط (تاگل روشن + پلنِ دارای ورکر + نشستِ معتبر) پُر می‌کند. این نقطه‌ای است که
 * «اپلای در خواب» را می‌سازد: یک cronِ بیرونی هر چند دقیقه این مسیر را صدا می‌زند و ناوگان
 * سپس صف را مصرف و اپلای می‌کند.
 *
 * مسیرِ «داخلی»: با هدرِ رازِ مشترک محافظت می‌شود و اگر رازِ سرور تنظیم نشده باشد fail-closed
 * می‌شود (۵۰۳). خودِ این مسیر هیچ اپلایی نمی‌کند — فقط کشف/صف‌گذاری بر اساس فیلترهای کاربر.
 *
 * هدر: X-Internal-Secret: <INTERNAL_API_SECRET>   ·   بدنه: ندارد.
 */
import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { runServerDiscovery, withDiscoveryLock } from "@/lib/apply/discovery-scheduler";

// به DB و شبکه (scrape/متر) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی یک تریگرِ نوشتنی نباید بیفتد.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ مشترک (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) اجرای دورِ کشف زیرِ قفلِ مشورتیِ سراسری — دو تیکِ هم‌پوشانِ cron را سریالی می‌کند
    //    تا کیف‌پولِ کاربر برای همان آگهی‌ها دوباره شارژ نشود. اگر قفل آزاد نبود، بی‌اثر رد شو.
    const summary = await withDiscoveryLock(
      () => runServerDiscovery(),
      () => ({
        skippedLocked: true,
        eligible: 0,
        processed: 0,
        deferred: 0,
        deadlineHit: false,
        queuedUsers: 0,
        skipped: 0,
        errors: 0,
        totalQueued: 0,
        totalPreparedResumes: 0,
        outcomes: [],
      }),
    );

    // ۳) خلاصه‌ی نوع‌دار. ۲۰۲ (Accepted/processed) برای یک اجرای دسته‌ای.
    return json(summary, 202);
  });
}
