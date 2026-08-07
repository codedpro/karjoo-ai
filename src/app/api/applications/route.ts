import "server-only";

/**
 * GET /api/applications — بایگانیِ اپلایِ خودِ کاربر (شرکت، JD، امتیاز، رزومه‌ی ارسال‌شده).
 *
 * منبعِ «چه چیزی برای چه کسی فرستادیم». مقید به نشست (کوکیِ وب یا Bearerِ افزونه)،
 * فقط-خواندنی، و هرگز cross-user.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { listApplicationArchive } from "@/lib/apply/application-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    const items = await listApplicationArchive(user.id, limit);
    return json({ count: items.length, items });
  });
}
