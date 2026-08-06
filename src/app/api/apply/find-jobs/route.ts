import "server-only";

/**
 * POST /api/apply/find-jobs — راه‌اندازِ «پیدا کردن شغل‌ها» (Track B، فاز ۲).
 *
 * پیوُت محصول: این اندپوینت مسیرِ *پیش‌فرضِ فیلترمود* را برای کاربرِ جاری اجرا می‌کند —
 * آگهی‌های فیلترشده‌ی خودِ سایت (دسته/شهر/نوع/دورکاری/حقوق/ترتیب) را scrape می‌کند و
 * *همه* را بدونِ هیچ هوش مصنوعی‌ای وارد صفِ اپلای می‌کند. این همان چیزی است که باعث
 * می‌شود شغل‌ها واقعاً در صف ظاهر شوند تا افزونه آن‌ها را (با تأییدِ صریحِ کاربر) اپلای کند.
 *
 * ایمنی/قواعد:
 *   • مقید به نشست (قاعده‌ی ۴/§۱۰): کاربر همیشه از کوکیِ نشست گرفته می‌شود، هرگز از بدنه.
 *   • بدونِ اپلای واقعی: صرفاً کشف + صف‌گذاری (runFilterApply هرگز connector.apply نمی‌زند).
 *   • سقفِ روزانه: dailyCap از پلنِ کاربر گرفته می‌شود (Free=۱۰۰/روز، پولی=نامحدود).
 *   • ایدمپوتنت: یک آگهی دوبار برای یک کاربر صف نمی‌شود (سازوکار در orchestrator).
 *
 * فیلترِ هوشمند (AI) — پریمیومِ اختیاری (هماهنگ با Track C): فقط اگر کاربر تاگلِ
 * `aiFilterEnabled` را روشن کرده باشد *و* واجدِ شرطِ AIِ پولی باشد (assertCanUsePaidAi)،
 * آگهی‌ها AI-score و فقط بالای آستانه صف می‌شوند. در غیرِ این صورت مسیرِ پایه (همه‌ی
 * آگهی‌ها) اجرا می‌شود — AI هرگز برای جریانِ پایه لازم نیست.
 *
 * این فایل از فایل‌های مالکیتیِ Foundation نیست؛ صرفاً مصرف‌کننده‌ی helperهای آن است
 * (readApplyFilters / runFilterApply) به‌علاوه‌ی نشست/پلن/استحقاق.
 */
import { errorJson, HttpError, json, withErrorHandling } from "@/lib/api/http";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { findJobsBodySchema } from "@/lib/api/find-jobs-schemas";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { readApplyFilters } from "@/lib/apply/filters";
import { runFilterApply } from "@/lib/apply/orchestrator";
import { readUserPlan } from "@/lib/billing/apply-quota-guard";
import { applyQuotaFor } from "@/lib/billing/plans";
import { assertCanUsePaidAi } from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ وب. کاربرِ هدف همیشه از نشست (نه از بدنه).
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // ۱.۵) گاردِ نرخ (ضدِبن، §۴): find-jobs یک اسکرَیپِ همزمانِ سمتِ سرور می‌زند؛ کلیک‌های
    //      پیاپی نباید IPِ کنترل‌پلین را به اسکرَیپِ مکررِ Jobinja وادار کنند. سقفِ کوتاهِ
    //      per-user → ۴۲۹ با Retry-After.
    const rl = checkRateLimit(`find-jobs:${user.id}`, 5, 60_000);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({
          error: "درخواست‌های زیاد؛ چند لحظه صبر کنید و دوباره تلاش کنید.",
          retryAfterSec: rl.retryAfterSec,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(rl.retryAfterSec),
          },
        },
      );
    }

    // ۲) بدنه — بدونِ ورودی؛ کلیدِ ناشناخته (مثلِ userIdِ جعلی) → ۴۰۰. بدنه‌ی خالی مجاز.
    await parseFindJobsBody(request);

    // ۳) فیلترهای ذخیره‌شده‌ی همین کاربر را بخوان (از candidate_profiles.preferences).
    const filters = await readApplyFilters(user.id);

    // ۴) اگر هیچ فیلترِ هدف‌گیری‌ای (دسته/شهر/نوعِ همکاری/دورکاری) نیست، چیزی برای
    //    هدف‌گیری وجود ندارد — پاسخِ دوستانه (نه خطا) تا کاربر به «فیلترهای اپلای» برود.
    //    (قبلاً فقط categorySlugs چک می‌شد و کاربرانِ «فقط شهر/نوع» را اشتباهاً می‌بست.)
    const hasTargeting =
      filters.categorySlugs.length > 0 ||
      filters.cities.length > 0 ||
      filters.jobTypes.length > 0 ||
      filters.remoteOnly;
    if (!hasTargeting) {
      return json(
        {
          enqueued: 0,
          reason: "no_filters",
          message:
            "هنوز فیلتری تنظیم نکرده‌اید. ابتدا در «فیلترهای اپلای» دسته، شهر یا نوعِ همکاری را انتخاب کنید.",
        },
        200,
      );
    }

    // ۵) فیلترِ هوشمند (AI) فقط وقتی روشن می‌شود که کاربر تاگل را زده باشد *و* واجدِ شرطِ
    //    AIِ پولی باشد. فقط «نداشتنِ استحقاق» (موجودیِ ناکافی) به مسیرِ پایه برمی‌گردد —
    //    قطعیِ svcِ 1xai ۵۰۳ می‌دهد؛ وگرنه کاربری که فیلترِ AI خواسته، در قطعیِ زیرساخت
    //    بی‌صدا به «اپلای انبوهِ بدونِ فیلتر» می‌افتاد (دقیقاً رفتاری که فیلتر باید مانعش شود).
    let aiFilter = false;
    if (filters.aiFilterEnabled) {
      try {
        await assertCanUsePaidAi(user.id);
        aiFilter = true;
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          aiFilter = false; // بدونِ استحقاق → مسیرِ پایه (AI هرگز اجباری نیست).
        } else {
          return errorJson(
            "کیف‌پولِ 1xai در دسترس نیست — فیلترِ هوشمند موقتاً ممکن نیست؛ کمی بعد دوباره تلاش کنید.",
            503,
          );
        }
      }
    }

    // ۶) سقفِ روزانه از پلنِ کاربر (Free=۱۰۰، پولی=نامحدود → MAX_SAFE_INTEGER).
    const plan = await readUserPlan(user.id);
    const dailyCap = applyQuotaFor(plan) ?? Number.MAX_SAFE_INTEGER;

    // ۷) اجرای فیلترمود: scrape → enqueue همه (یا در aiFilter، بالای آستانه).
    const report = await runFilterApply({ userId: user.id, aiFilter, dailyCap });

    return json({
      enqueued: report.queued,
      alreadyQueued: report.alreadyQueued,
      ingested: report.ingested,
      skippedByCap: report.skippedByCap,
      aiFilter: report.aiFilter,
      // آیا به انتهای نتایجِ فعلی رسیدیم (اجرای بعد از سرِ فهرست دوباره اسکن می‌کند)؟
      reachedEnd: report.reachedEnd,
    });
  });
}

/**
 * بدنه‌ی find-jobs را امن می‌خواند: بدنه‌ی خالی/غایب → `{}`؛ بدنه‌ی غیرJSON یا دارای
 * کلیدِ ناشناخته → HttpError(400) (defense-in-depth برای قاعده‌ی ۴). چیزی از بدنه
 * استفاده نمی‌شود؛ صرفاً اعتبارسنجیِ سخت‌گیرانه تا کلاینت نتواند فیلدِ ناخواسته تزریق کند.
 */
async function parseFindJobsBody(request: Request): Promise<void> {
  const text = await request.text();
  if (!text.trim()) {
    findJobsBodySchema.parse({});
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const result = findJobsBodySchema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, "validation failed");
  }
}
