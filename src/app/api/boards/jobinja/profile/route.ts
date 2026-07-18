import "server-only";

/**
 * PUT /api/boards/jobinja/profile  (وب، کوکیِ کاربر)  — body: { jobTitle?, fullName?, workingStatus? }
 *
 * فیلدهای اصلیِ پروفایلِ جابینجای کاربر را با نشستِ vault به‌روزرسانی می‌کند (basic-data)، سپس
 * عکس‌برداریِ نمایش را تازه می‌کند. فقط فیلدهای داده‌شده. §10: هیچ چیزِ جعلی — فقط ویرایشِ کاربر.
 */
import { z } from "zod";

import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { updateJobinjaBasicData, JobinjaWriteError } from "@/lib/apply/boards/jobinja-write";
import { syncJobinjaFromVault } from "@/lib/apply/boards/jobinja-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    jobTitle: z.string().trim().max(160).optional(),
    fullName: z.string().trim().max(160).optional(),
    workingStatus: z.enum(["seeking", "employed", "freelance"]).optional(),
  })
  .strict();

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("برای ویرایشِ پروفایل وارد شوید.", 401);

    let edits: z.infer<typeof bodySchema>;
    try {
      edits = bodySchema.parse(await request.json());
    } catch {
      return errorJson("ورودیِ نامعتبر.", 400);
    }

    try {
      await updateJobinjaBasicData(user.id, edits);
    } catch (err) {
      if (err instanceof JobinjaWriteError) {
        if (err.code === "no_session") {
          return errorJson("نشستِ جابینجا متصل نیست — از افزونه وصل کنید.", 409);
        }
        if (err.code === "no_cv_id") {
          return errorJson("شناسه‌ی رزومه‌ی جابینجا پیدا نشد؛ یک‌بار در جابینجا رزومه‌ساز را باز کنید.", 422);
        }
        return errorJson("به‌روزرسانیِ جابینجا ناموفق بود؛ کمی بعد دوباره تلاش کنید.", 502);
      }
      throw err;
    }

    // عکس‌برداریِ نمایش را تازه کن (best-effort).
    await syncJobinjaFromVault(user.id).catch(() => {});
    return json({ ok: true }, 200);
  });
}
