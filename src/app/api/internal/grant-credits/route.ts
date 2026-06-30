import "server-only";

/**
 * POST /api/internal/grant-credits
 *
 * اجرای «گرنتِ اعتبارِ ماهانه» را برای کاربران تریگر می‌کند — قرار است یک کرانِ ماهانه
 * (بیرونِ اپ) این مسیر را صدا بزند. مثلِ /api/internal/ingest «داخلی» است: با هدرِ رازِ
 * مشترک (X-Internal-Secret) محافظت می‌شود و اگر رازِ سرور تنظیم نشده باشد fail-closed
 * می‌شود (۵۰۳) — هرگز با رازِ خالی باز نمی‌ماند.
 *
 * گرنت *ایدمپوتنت به‌ازای (کاربر، ماه)* است (grantMonthlyCredits)؛ پس صدا زدنِ دوباره‌ی
 * این مسیر در همان ماه دوبار اعتبار نمی‌دهد — کران می‌تواند با خیال راحت retry کند.
 *
 * بدنه (JSON، همه اختیاری):
 *   { userIds?: uuid[], all?: boolean }
 *   • userIds: فقط همین کاربران را گرنت کن (هدف‌مند — مثلاً پس از ارتقا).
 *   • all (یا بدنه‌ی خالی): همه‌ی کاربرانِ فعالِ پلن‌دارِ پولی را گرنت کن (اجرای ماهانه).
 *
 * هدر: X-Internal-Secret: <INTERNAL_API_SECRET>
 *
 * ── درزِ کران (cron seam) ─────────────────────────────────────────────────
 * اسکجولرِ واقعی بعداً می‌آید. تا آن زمان یک کرانِ بیرونی (مثلِ crontab سیستم یا یک
 * job در زیرساخت) باید *ماهانه* (مثلاً ۰۰:۱۰ روزِ اولِ هر ماه) این مسیر را با هدرِ راز
 * POST کند، یا اسکریپتِ src/scripts/grant-monthly.ts را اجرا کند. .env.example هم یک
 * یادداشت دارد. این مسیر *عمداً* اسکجولر داخلی نمی‌سازد.
 */
import { z } from "zod";

import { guardInternal, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { runMonthlyGrants } from "@/lib/billing/grant-runner";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — تریگرِ نوشتنی نباید کش شود.
export const dynamic = "force-dynamic";

/** بدنه‌ی POST — همه اختیاری؛ بدنه‌ی خالی = «اجرای ماهانه‌ی همه». */
const grantCreditsBodySchema = z
  .object({
    /** فقط همین کاربران را گرنت کن (UUIDهای معتبر). */
    userIds: z
      .array(z.string().uuid("هر userId باید UUID معتبر باشد"))
      .max(10_000, "حداکثر ۱۰۰۰۰ کاربر در هر فراخوانی")
      .optional(),
    /** صریحاً «همه‌ی کاربرانِ واجدِ شرایط» (پیش‌فرض اگر userIds داده نشود). */
    all: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ مشترک (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) اعتبارسنجیِ بدنه (بدنه‌ی خالی هم مجاز است → اجرای همه).
    const body = await parseJsonBody(request, grantCreditsBodySchema);

    // ۳) اجرای گرنتِ ماهانه (ایدمپوتنت). اگر userIds داده شده، فقط همان‌ها؛ وگرنه همه.
    const summary = await runMonthlyGrants({ userIds: body.userIds });

    // ۴) خلاصه‌ی نوع‌دار: چند کاربر دیده شد، چند گرنت داده شد/رد شد، جمعِ اعتبار.
    return json(summary, 200);
  });
}
