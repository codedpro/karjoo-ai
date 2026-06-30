import "server-only";

/**
 * POST /api/fleet/result
 *
 * نتیجه‌ی یک کارِ اجراشده توسطِ نودِ کارگرِ احرازشده را ثبت می‌کند (Track A، قاعده‌ی ۳).
 * recordFleetResult یک ردیفِ applications (channel='worker') و یک ردیفِ audit_events
 * (auto_apply_attempted، channel=worker، nodeId) می‌نویسد — همگی مقید به همان userId.
 *
 * احراز: اعتبارنامه‌ی نود (requireNodeCredential). nodeId در ممیزی *همیشه* از اعتبارنامه
 * می‌آید، نه از بدنه. `userId`/`taskId` در بدنه از همان FleetJobی‌اند که سرور پیش‌تر به
 * این نود داد؛ مالکیتِ نهایی در هسته دوباره سنجیده می‌شود: اگر task به این کاربر تعلق
 * نداشته باشد → null → ۴۰۹ (و *هیچ* ممیزی/نتیجه‌ای نوشته نمی‌شود).
 *
 * بدنه (JSON): { taskId, userId, status, externalRef?, reason?, proof? }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import { fleetResultBodySchema } from "@/lib/api/fleet-schemas";
import { recordFleetResult } from "@/lib/fleet/dispatch";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ نود (۴۰۱ اگر اعتبارنامه نامعتبر).
    const node = await requireNodeCredential(request);

    // ۲) اعتبارسنجیِ بدنه (strict — مادهٔ سری/فیلدِ ناشناخته رد).
    const body = await parseJsonBody(request, fleetResultBodySchema);

    // ۳) ثبتِ نتیجه — nodeId همیشه از اعتبارنامه. مقید به userIdِ بدنه ولی هسته مالکیتِ
    //    task توسطِ همان کاربر را دوباره می‌سنجد.
    const result = await recordFleetResult(node.id, {
      taskId: body.taskId,
      userId: body.userId,
      status: body.status,
      ...(body.externalRef !== undefined ? { externalRef: body.externalRef } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      ...(body.proof !== undefined ? { proof: body.proof } : {}),
    });

    // task متعلق به این کاربر نیست/یافت نشد → ۴۰۹ (تضادِ مالکیت؛ هیچ ممیزی ننوشته شد).
    if (!result) {
      return json({ error: "apply task not found for user" }, 409);
    }

    return json({
      application: result.application,
      taskStatus: result.taskStatus,
    });
  });
}
