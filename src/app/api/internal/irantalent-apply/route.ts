import "server-only";

/**
 * POST /api/internal/irantalent-apply — تیکِ اپلایِ سمتِ سرورِ ایران‌تلنت (internal-only).
 *
 * ایران‌تلنت تنها سایتی است که اپلایش کاملاً HTTP است، پس نیازی به نودِ ورکر و مرورگر
 * ندارد و مستقیم روی کنترل‌پلین اجرا می‌شود. برای هر کاربرِ واجد، نشست از خزانه خوانده
 * (یا با اعتبارنامه‌ی ذخیره‌شده ساخته) می‌شود و چند آیتمِ صف اجرا می‌شود.
 *
 * ایمنی: `guardInternal` (رازِ مشترک) — از اینترنت قابلِ فراخوانی نیست. با قفلِ مشورتی
 * خودسریالایز می‌شود تا دو تیکِ هم‌پوشان یک آگهی را دوبار اپلای نکنند.
 */
import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { runIranTalentTick } from "@/lib/fleet/irantalent-runner";
import { withIranTalentApplyLock } from "@/lib/fleet/irantalent-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    return withIranTalentApplyLock(
      async () => json(await runIranTalentTick()),
      () => json({ skipped: "another tick is already running" }, 200),
    );
  });
}
