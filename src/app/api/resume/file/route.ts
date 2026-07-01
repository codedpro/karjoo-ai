import "server-only";

/**
 * DELETE /api/resume/file — حذفِ یک فایلِ رزومه‌ی آپلودشده (نشستِ وب).
 *
 * جریان:
 *   ۱) احراز هویتِ وب → userId.
 *   ۲) اعتبارسنجیِ بدنه ({ resumeFileId }).
 *   ۳) حذفِ رکوردِ resume_files *فقط اگر متعلق به همین کاربر باشد* (قاعده‌ی ۴) و گرفتنِ
 *      مسیرِ دیسک.
 *   ۴) پاک‌کردنِ فایلِ فیزیکی (best-effort — اگر فایل نبود مشکلی نیست).
 *
 * رایگان است (هیچ فراخوانیِ مدل ندارد). حذف برگشت‌ناپذیر است.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { resumeDeleteFileSchema } from "@/lib/resume/api-schemas";
import { deleteResumeFile } from "@/lib/resume/profile-service";
import { deleteStoredResumeFile } from "@/lib/resume/storage";

// به DB و دیسک دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    const body = await parseJsonBody(request, resumeDeleteFileSchema);

    const result = await deleteResumeFile(user.id, body.resumeFileId);
    if (!result.deleted) {
      return errorJson("رزومه یافت نشد.", 404);
    }

    // فایلِ فیزیکی را هم پاک کن (best-effort — رکورد از قبل حذف شده).
    if (result.storagePath) {
      try {
        await deleteStoredResumeFile(result.storagePath);
      } catch {
        // شکستِ حذفِ دیسک نباید موفقیتِ حذفِ رکورد را باطل کند (رکورد رفته).
      }
    }

    return json({ ok: true, resumeFileId: body.resumeFileId });
  });
}
