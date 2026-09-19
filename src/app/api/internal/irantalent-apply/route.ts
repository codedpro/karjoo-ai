import "server-only";

/**
 * POST /api/internal/irantalent-apply — تیکِ اپلایِ سمتِ سرورِ ایران‌تلنت (internal-only).
 *
 * **میراثی.** وقتی ایران‌تلنت تنها سایتِ کنترل‌پلین بود، این مسیر تیکش را می‌زد. حالا
 * کاربوم و ای‌استخدام هم همان‌جا اجرا می‌شوند و مسیرِ جاری `/api/internal/server-apply`
 * است که هر سه را می‌زند؛ cron هم همان را صدا می‌کند. این مسیر فقط ایران‌تلنت را اجرا
 * می‌کند و برای فراخوانندگانِ قدیمی مانده است. هر دو **یک** قفل دارند، پس اگر هم‌زمان
 * صدا شوند هیچ آگهی‌ای دوبار اپلای نمی‌شود.
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
