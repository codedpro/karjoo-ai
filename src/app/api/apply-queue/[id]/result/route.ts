import "server-only";

/**
 * POST /api/apply-queue/:id/result
 *
 * نتیجه‌ی یک اپلای را در افزونه ثبت می‌کند (channel='extension'). `:id` شناسه‌ی task است.
 * با نشستِ افزونه (Bearer) احراز می‌شود.
 *
 * منبعِ اپلای: یا حالتِ «اپلای خودکار» (افزونه در پس‌زمینه، که در چوک‌پوینتِ claim با
 * تاگلِ رضایت + سقفِ روزانه + آستانه‌ی امتیاز گیت می‌شود)، یا اپلایِ دستیِ تأییدشده‌ی کاربر.
 * در هر دو حالت این تنها راهِ پیشرفتِ یک آیتمِ صف است و هر نتیجه یک ردیفِ audit_events
 * می‌نویسد (قاعده‌ی ۱، §۱۰). قاعده‌ی ۴: task باید به match‌ای از همین کاربر تعلق داشته باشد، وگرنه ۴۰۴.
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
import { recordAutoApplyAudit } from "@/lib/apply/auto-apply";
import { assertApplyQuotaForUser } from "@/lib/billing/apply-quota-guard";
import { ApplyQuotaError } from "@/lib/billing/errors";
import {
  assertExtensionExecutionOwner,
  ExecutionOwnershipError,
} from "@/lib/apply/execution-run";

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
    if (body.executorId) {
      try {
        await assertExtensionExecutionOwner(userId, body.executorId);
      } catch (error) {
        if (error instanceof ExecutionOwnershipError) {
          return json({ error: error.message, code: error.code }, 409);
        }
        throw error;
      }
    } else if (body.status === "submitted") {
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

    // قاعده‌ی ۱ (§۱۰): هر تلاشِ اپلای خودکار یک ردیفِ ممیزی می‌نویسد. best-effort —
    // شکستِ نوشتنِ ممیزی نباید ثبتِ نتیجه را بشکند (در لاگِ سرور دیده می‌شود).
    try {
      await recordAutoApplyAudit({
        userId,
        eventType:
          body.status === "skipped" ? "auto_apply_skipped" : "auto_apply_attempted",
        applicationId: result.application?.id,
        metadata: {
          taskId: id,
          status: body.status,
          taskStatus: result.taskStatus,
          ...(body.externalRef ? { externalRef: body.externalRef } : {}),
          ...(body.reason ? { reason: body.reason } : {}),
        },
      });
    } catch (auditErr) {
      console.error("[apply-result] audit write failed:", auditErr);
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
