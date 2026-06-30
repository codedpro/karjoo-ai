import "server-only";

/**
 * POST /api/apply-queue/claim
 *
 * آیتم‌های اپلایِ pendingِ همین کاربر را برای اپلایِ خودکار/کمکی برمی‌گرداند
 * (CONTEXT، قاعده‌ی ۱، ۲ و ۴). با نشستِ افزونه (Bearer) احراز می‌شود.
 *
 * چوک‌پوینتِ گیتِ اپلای خودکار (قاعده‌ی ۱): این مسیر آیتم برمی‌گرداند *فقط اگر* تاگلِ
 * اپلای خودکارِ کاربر روشن باشد، زیرِ سقفِ روزانه باشیم، و فقط آیتم‌هایی که score ≥ آستانه‌ی
 * کاربرند. اگر تاگل خاموش یا سقف پر باشد، صفِ خالی + reason برگردانده می‌شود (هیچ اپلایی).
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
import { readUserPlan } from "@/lib/billing/apply-quota-guard";
import {
  assertAutoApplyAllowed,
  AutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه.
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) بدنه‌ی اختیاری (limit). بدنه‌ی خالی هم مجاز است (پیش‌فرض limit=5).
    const body = await parseClaimBody(request);

    // ۳) گیتِ اپلای خودکار (قاعده‌ی ۱) — پیش از برگرداندنِ هر آیتم.
    //    پلنِ کاربر را از DB می‌خوانیم (سقفِ روزانه از روی پلن) و گیت را اعمال می‌کنیم.
    //    خاموش‌بودنِ تاگل یا پربودنِ سقف ⇒ صفِ خالی + reason (نه خطا) تا افزونه آرام بایستد.
    const plan = await readUserPlan(userId);
    let minScore: number;
    try {
      const allowance = await assertAutoApplyAllowed(userId, plan);
      minScore = allowance.minScore;
    } catch (err) {
      if (err instanceof AutoApplyNotAllowedError) {
        return json({ count: 0, items: [], reason: err.code }, 200);
      }
      throw err;
    }

    // ۴) فقط آیتم‌های همین کاربر و بالای آستانه (قاعده‌ی ۱ و ۴).
    const items = await claimUserApplyItems(userId, body.limit, undefined, {
      minScore,
    });

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
