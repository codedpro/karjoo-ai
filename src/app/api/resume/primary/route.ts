import "server-only";

/**
 * POST /api/resume/primary — یک فایلِ آپلودشده را «رزومه‌ی اصلی» می‌کند (نشستِ وب).
 *
 * مسیرِ PDF-only (WF2): کاربر یک PDF را *بدونِ* استخراجِ هوش مصنوعی به‌عنوانِ رزومه‌ی اصلی
 * تعیین می‌کند تا مستقیم به اپلای‌ها بچسبد. این کنش کاملاً رایگان است (هیچ فراخوانیِ مدل
 * ندارد). حداکثر یک رزومه‌ی اصلی به‌ازای هر کاربر (ایندکسِ partial-unique) — سرویس اتمیک
 * اول همه را false و سپس این یکی را true می‌کند.
 *
 * امنیت (قاعده‌ی ۴): userId از نشست؛ فقط فایلِ خودِ کاربر می‌تواند اصلی شود.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { resumeSetPrimarySchema } from "@/lib/resume/api-schemas";
import { setPrimaryResumeFile } from "@/lib/resume/profile-service";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    const body = await parseJsonBody(request, resumeSetPrimarySchema);

    const ok = await setPrimaryResumeFile(user.id, body.resumeFileId);
    if (!ok) {
      return errorJson("رزومه یافت نشد.", 404);
    }

    return json({ ok: true, resumeFileId: body.resumeFileId });
  });
}
