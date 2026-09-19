import "server-only";

/**
 * POST /api/internal/server-apply — تیکِ «اپلایِ سمتِ سرور» (internal-only).
 *
 * همه‌ی سایت‌هایی که اپلای‌شان یک تراکنشِ HTTP است — ایران‌تلنت، کاربوم، ای‌استخدام —
 * این‌جا اجرا می‌شوند: بدونِ مرورگر و بدونِ نودِ ورکر. برای هر کاربرِ واجد، نشست از خزانه
 * خوانده (یا با اعتبارنامه‌ی ذخیره‌شده ساخته) می‌شود و چند آیتمِ صف اجرا می‌شود.
 *
 * جابینجا و جاب‌ویژن این‌جا نیستند: فرم/جریانِ DOM دارند و نودِ ناوگان آن‌ها را با
 * Playwright می‌راند. جدولِ کانال‌ها در `apply/apply-channels.ts` است.
 *
 * ایمنی: `guardInternal` (رازِ مشترک) — از اینترنت قابلِ فراخوانی نیست. با قفلِ مشورتی
 * خودسریالایز می‌شود تا دو تیکِ هم‌پوشان یک آگهی را دوبار اپلای نکنند.
 */
import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { runServerApplyTick } from "@/lib/fleet/server-apply-runner";
import { withServerApplyLock } from "@/lib/fleet/server-apply-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    return withServerApplyLock(
      async () => json(await runServerApplyTick()),
      () => json({ skipped: "another tick is already running" }, 200),
    );
  });
}
