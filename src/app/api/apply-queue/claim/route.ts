import "server-only";

/**
 * POST /api/apply-queue/claim
 *
 * آیتم‌های اپلایِ pendingِ همین کاربر را برای «اپلایِ کمکیِ حاضرِ کاربر» برمی‌گرداند
 * (CONTEXT، قاعده‌ی ۲ و ۴). با نشستِ افزونه (Bearer) احراز می‌شود.
 *
 * مرزِ ایمنی: این «ارسال» نیست. صرفاً آیتم‌هایی را که از پیش (با تأییدِ کاربر/آستانه)
 * وارد صف شده‌اند به افزونه می‌دهد تا فرم را پیش‌پُر کند؛ کاربر باید در UI افزونه هر
 * ارسال را صریحاً تأیید کند و نتیجه را با `/api/apply-queue/:id/result` گزارش دهد.
 * هیچ پیشرویِ خودکار/پس‌زمینه‌ای بدونِ آن گزارش رخ نمی‌دهد.
 *
 * بدنه (JSON، اختیاری): { limit?: 1..25 }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { applyQueueClaimBodySchema } from "@/lib/api/extension-schemas";
import { claimUserApplyItems } from "@/lib/apply/extension-queue";

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

    // ۳) فقط آیتم‌های همین کاربر (قاعده‌ی ۴).
    const items = await claimUserApplyItems(userId, body.limit);

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
