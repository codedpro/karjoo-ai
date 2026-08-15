import "server-only";

/**
 * POST /api/apply-queue/claim
 *
 * آیتم‌های اپلایِ pendingِ همین کاربر را برای اپلای برمی‌گرداند (CONTEXT، قاعده‌ی ۱، ۲ و ۴).
 * با نشستِ افزونه (Bearer) احراز می‌شود.
 *
 * دو مسیر (پیوُت محصول):
 *   • **فیلترمود (جریانِ پیش‌فرض)** — آیتم‌هایی که کاربر با «فیلترهای اپلای» و «پیدا کردن
 *     شغل‌ها» ساخته (payload.mode='filter'، بدونِ AI). این‌ها *نیازی به تاگلِ اپلای خودکار
 *     ندارند*: خودِ تنظیمِ فیلتر + کلیکِ کاربر رضایتِ صف‌گذاری است، و ارسالِ هر آیتم همچنان
 *     در افزونه صریحاً تأیید می‌شود (قاعده‌ی ۲). این‌ها گیتِ آستانه نمی‌خورند.
 *   • **AIمود (پریمیوم)** — آیتم‌های تطبیقِ هوش مصنوعی (payload.mode='ai', score دارد).
 *     این‌ها *فقط* وقتی برمی‌گردند که تاگلِ اپلای خودکار روشن باشد و score ≥ آستانه‌ی کاربر
 *     (قاعده‌ی ۱).
 *
 * سقفِ روزانه (anti-ban، بخش ۴) برای *هر دو* مسیر اعمال می‌شود: اگر سقف پر باشد صفِ
 * خالی + reason='quota_exceeded' برگردانده می‌شود.
 *
 * مرزِ ایمنی: این «ارسال» نیست. صرفاً آیتم‌های واجدِ شرط را به افزونه می‌دهد؛ ثبتِ نتیجه
 * فقط با `/api/apply-queue/:id/result` انجام می‌شود (قاعده‌ی ۲). هرگز آیتمِ کاربرِ دیگر
 * برنمی‌گردد (قاعده‌ی ۴).
 *
 * بدنه (JSON، اختیاری): { limit?: 1..25 }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { applyQueueClaimBodySchema } from "@/lib/api/extension-schemas";
import { claimUserApplyItems } from "@/lib/apply/extension-queue";
import {
  assertApplyQuotaForUser,
  readUserPlan,
} from "@/lib/billing/apply-quota-guard";
import { ApplyQuotaError } from "@/lib/billing/errors";
import {
  assertAutoApplyAllowed,
  AutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import {
  assertExtensionExecutionOwner,
  ExecutionOwnershipError,
  releaseStaleExtensionLeases,
} from "@/lib/apply/execution-run";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * آستانه‌ی «دست‌نیافتنی» برای وقتی تاگلِ اپلای خودکار خاموش است: score همیشه در بازه‌ی
 * [۰،۱] است، پس این مقدار هیچ آیتمِ AIمودی را عبور نمی‌دهد — اما آیتم‌های فیلترمود از
 * طریقِ شرطِ OR در extension-queue همچنان عبور می‌کنند. نتیجه: «فقط فیلترمود».
 */
const AI_TASKS_EXCLUDED_MIN_SCORE = Number.MAX_SAFE_INTEGER;

/**
 * سقفِ درخواستیِ claim را به ظرفیتِ *باقی‌مانده‌ی* سهمیه‌ی امروز محدود می‌کند تا اجاره
 * هرگز بیش از remaining نباشد (وگرنه یک کاربرِ ۹۹/۱۰۰ می‌توانست ۲۵ آیتم اجاره و ثبت کند
 * و سقفِ ضدِبنِ روزانه را بشکند). `remaining=null` = پلنِ نامحدود → بدونِ محدودسازی.
 */
function clampToRemaining(requested: number, remaining: number | null): number {
  if (remaining === null) return requested;
  return Math.max(0, Math.min(requested, remaining));
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه.
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) بدنه‌ی اختیاری (limit). بدنه‌ی خالی هم مجاز است (پیش‌فرض limit=5).
    const body = await parseClaimBody(request);

    // New extension executor path: explicit cloud ownership is the consent gate.
    // It is free, filter-authoritative, unlimited, and does not consult scores or
    // plan application quotas. Legacy/manual clients continue through the old
    // guarded branch below for backward compatibility.
    if (body.executorId) {
      try {
        await assertExtensionExecutionOwner(userId, body.executorId);
      } catch (error) {
        if (error instanceof ExecutionOwnershipError) {
          return json({ error: error.message, code: error.code }, 409);
        }
        throw error;
      }
      await releaseStaleExtensionLeases(userId);
      const items = await claimUserApplyItems(userId, body.limit);
      return json({ count: items.length, items });
    }

    // ۳) پلنِ کاربر را از DB می‌خوانیم (سقفِ روزانه از روی پلن).
    const plan = await readUserPlan(userId);

    // ۴) گیتِ اپلای خودکارِ AI (قاعده‌ی ۱). اگر روشن و زیرِ سقف باشد → مسیرِ کامل: آیتم‌های
    //    AIمود بالای آستانه + همه‌ی آیتم‌های فیلترمود.
    let minScore: number;
    let remaining: number | null = null;
    try {
      const allowance = await assertAutoApplyAllowed(userId, plan);
      minScore = allowance.minScore;
      remaining = allowance.quota.remaining;
    } catch (err) {
      if (err instanceof AutoApplyNotAllowedError) {
        // سقفِ روزانه پر → برای هر دو مسیر متوقف (صفِ خالی + reason).
        if (err.code === "quota_exceeded") {
          return json({ count: 0, items: [], reason: err.code }, 200);
        }

        // تاگلِ AI خاموش (code='disabled'): جریانِ پیش‌فرضِ فیلترمود نیازی به تاگل ندارد.
        // *فقط* آیتم‌های فیلترمود را برمی‌گردانیم (AIمود با آستانه‌ی دست‌نیافتنی حذف می‌شود)،
        // با همان سقفِ روزانه.
        let filterRemaining: number | null;
        try {
          filterRemaining = (await assertApplyQuotaForUser(userId)).remaining;
        } catch (qerr) {
          if (qerr instanceof ApplyQuotaError) {
            return json({ count: 0, items: [], reason: "quota_exceeded" }, 200);
          }
          throw qerr;
        }

        const filterItems = await claimUserApplyItems(
          userId,
          clampToRemaining(body.limit, filterRemaining),
          undefined,
          { minScore: AI_TASKS_EXCLUDED_MIN_SCORE },
        );
        return json({ count: filterItems.length, items: filterItems });
      }
      throw err;
    }

    // ۵) مسیرِ کامل — آیتم‌های همین کاربر: AIمود بالای آستانه + فیلترمود (قاعده‌ی ۱ و ۴).
    const items = await claimUserApplyItems(
      userId,
      clampToRemaining(body.limit, remaining),
      undefined,
      { minScore },
    );

    return json({ count: items.length, items });
  });
}

/**
 * بدنه‌ی claim را امن می‌خواند: بدنه‌ی خالی/غیرJSON را به پیش‌فرضِ اسکیما نگاشت می‌کند
 * (limit=5)؛ بدنه‌ی موجودِ نامعتبر را به ۴۰۰ می‌برد.
 */
async function parseClaimBody(request: Request) {
  // بدنه‌ی خالی (بدونِ Content) → پیش‌فرضِ اسکیما.
  const text = await request.text();
  if (!text.trim()) {
    return applyQueueClaimBodySchema.parse(undefined);
  }
  const fakeRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  return parseJsonBody(fakeRequest, applyQueueClaimBodySchema);
}
