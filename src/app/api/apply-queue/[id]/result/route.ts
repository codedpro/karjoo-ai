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
import { assertApplyQuotaForUser } from "@/lib/billing/apply-quota-guard";
import { ApplyQuotaError } from "@/lib/billing/errors";

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

    // ۳٫۵) گاردِ سهمیه‌ی اپلای روزانه (WF3 بخش D) — فقط برای اپلایِ واقعی (submitted).
    //      کاربرِ free حداکثر ۱۰۰ اپلای/روز دارد؛ پلن‌های پولی نامحدودند (بدونِ کوئریِ شمارش).
    //      گزارشِ skipped/failed سهمیه نمی‌سوزاند (تا کاربر بتواند همیشه نتیجه را گزارش کند).
    //      ApplyQuotaError → ۴۲۹ با پیامِ فارسیِ روشن.
    if (body.status === "submitted") {
      try {
        await assertApplyQuotaForUser(userId);
      } catch (err) {
        if (err instanceof ApplyQuotaError) {
          // کد/اعداد در سطحِ بالای بدنه می‌آیند تا UI سقفِ روزانه را دقیق تشخیص دهد.
          return json(
            {
              error: err.message,
              code: err.code,
              usedToday: err.usedToday,
              limit: err.limit,
            },
            429,
          );
        }
        throw err;
      }
    }

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
