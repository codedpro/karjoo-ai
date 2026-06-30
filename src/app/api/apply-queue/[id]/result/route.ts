import "server-only";

/**
 * POST /api/apply-queue/:id/result
 *
 * نتیجه‌ی یک اپلایِ **تأییدشده‌ی کاربر** را در افزونه ثبت می‌کند (channel='extension').
 * با نشستِ افزونه (Bearer) احراز می‌شود. `:id` شناسه‌ی task است.
 *
 * قاعده‌ی ۲ (CONTEXT): این تنها راهِ پیشرفتِ یک آیتمِ صف است — هر ارسال به یک اقدامِ
 * تأییدِ صریحِ کاربر در UI افزونه نیاز دارد و افزونه نتیجه را اینجا گزارش می‌کند.
 * هیچ‌جا اپلای به‌صورت خودکار/پس‌زمینه جلو نمی‌رود.
 * قاعده‌ی ۴: task باید به match‌ای از همین کاربر تعلق داشته باشد، وگرنه ۴۰۴.
 *
 * بدنه (JSON): { status: 'submitted'|'skipped'|'failed', externalRef?, reason?, proof? }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import {
  applyQueueResultBodySchema,
  taskIdParamSchema,
} from "@/lib/api/extension-schemas";
import { recordResult } from "@/lib/apply/extension-queue";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه.
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) اعتبارسنجیِ پارامترِ مسیر (params در Next 16 async است → await).
    const { id } = taskIdParamSchema.parse(await params);

    // ۳) اعتبارسنجیِ بدنه.
    const body = await parseJsonBody(request, applyQueueResultBodySchema);

    // ۴) ثبتِ نتیجه — مقید به همین کاربر. اگر task به این کاربر تعلق نداشت → ۴۰۴.
    const result = await recordResult({
      taskId: id,
      userId,
      status: body.status,
      externalRef: body.externalRef,
      reason: body.reason,
      proof: body.proof,
    });

    if (!result) {
      return json({ error: "apply task not found" }, 404);
    }

    return json(
      {
        application: result.application,
        taskStatus: result.taskStatus,
      },
      200,
    );
  });
}
