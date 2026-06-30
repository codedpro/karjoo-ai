import "server-only";

/**
 * POST /api/internal/ingest
 *
 * یک اجرای «ingest عمومی + تطبیق» جابینجا را برای یک پروفایلِ ذخیره‌شده تریگر می‌کند.
 * مسیرِ «داخلی» است: تا قبل از احراز هویتِ واقعی، با هدرِ رازِ مشترک محافظت می‌شود و
 * اگر رازِ سرور تنظیم نشده باشد fail-closed می‌شود (۵۰۳). فقط-خواندنی؛ هیچ اپلایی نیست.
 *
 * بدنه (JSON): { profileId: uuid, scoreThreshold?: 0..1, limit?: int }
 * هدر: X-Internal-Secret: <INTERNAL_API_SECRET>
 */
import { guardInternal, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { ingestBodySchema } from "@/lib/api/schemas";
import { runJobinjaIngest } from "@/lib/apply/orchestrator";

// به DB و node API دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی یک تریگرِ نوشتنی نباید بیفتد.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ مشترک (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) اعتبارسنجیِ بدنه.
    const body = await parseJsonBody(request, ingestBodySchema);

    // ۳) فراخوانیِ هماهنگ‌کننده.
    const result = await runJobinjaIngest({
      profileId: body.profileId,
      scoreThreshold: body.scoreThreshold,
      limit: body.limit,
    });

    // ۴) پاسخِ نوع‌دار. ۲۰۲ (Accepted/processed) برای یک اجرای پردازشی.
    return json(result, 202);
  });
}
