import "server-only";

/**
 * GET /api/resume/tailored?id=<resumeId>  (وب، کوکیِ کاربر)
 *
 * HTMLِ رزومه‌ی هدف‌گیری‌شده‌ی ذخیره‌شده را برای مالک برمی‌گرداند (content-type: text/html) تا
 * در iframe/تبِ نو پیش‌نمایش یا با «چاپ → ذخیره‌ی PDF» دانلود شود. فقط مالک؛ ۴۰۴ در غیرِ این‌صورت.
 */
import { errorJson, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { getTailoredResumeHtml } from "@/lib/resume/custom-resume-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("وارد شوید.", 401);

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return errorJson("شناسه‌ی رزومه لازم است.", 400);

    const row = await getTailoredResumeHtml(user.id, id);
    if (!row) return errorJson("رزومه یافت نشد.", 404);

    return new Response(row.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // در همان مبدأ نمایش داده می‌شود؛ جاسازیِ بیرونی مجاز نیست.
        "X-Frame-Options": "SAMEORIGIN",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
