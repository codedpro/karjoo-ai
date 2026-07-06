import "server-only";

/**
 * POST /api/wallet/topup — ثبتِ درخواستِ شارژِ کیف‌پول به‌روشِ کارت‌به‌کارت.
 *
 * ⚠️ این *اعتباری اضافه نمی‌کند*. کاربر مبلغ را به کارتِ مقصد منتقل و کدِ پیگیری را
 * ثبت می‌کند؛ یک درخواستِ `pending` ساخته می‌شود و کیف‌پول فقط پس از *تأییدِ ادمین*
 * (که واقعاً رسیدِ کارت‌به‌کارت را وارسی می‌کند) credit می‌شود. پس هیچ کاربری نمی‌تواند
 * خودش را رایگان شارژ کند (رفعِ ریشه‌ایِ استابِ خودشارژِ توسعه).
 *
 * امنیت (قاعده‌ی ۴): کاربرِ هدف همیشه از کوکیِ نشست است، نه از بدنه.
 */
import { z } from "zod";

import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { MAX_TOPUP_TOMAN, MIN_TOPUP_TOMAN } from "@/lib/api/billing-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { cardToCardInfo } from "@/lib/env";
import { createPaymentRequest } from "@/lib/billing/payments";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** بدنه‌ی درخواستِ شارژِ کارت‌به‌کارت: مبلغ + کدِ پیگیری (+ اختیاری‌ها). */
const cardTopupBodySchema = z
  .object({
    amountToman: z.coerce
      .number()
      .int()
      .min(MIN_TOPUP_TOMAN, `حداقل مبلغِ شارژ ${MIN_TOPUP_TOMAN} تومان است.`)
      .max(MAX_TOPUP_TOMAN, `حداکثر مبلغِ شارژ ${MAX_TOPUP_TOMAN} تومان است.`),
    /** کدِ پیگیری/رهگیریِ تراکنش (از اپِ بانک). */
    referenceCode: z.string().trim().min(1).max(64).optional(),
    /** ۴ رقمِ آخرِ کارتِ پرداخت‌کننده (اختیاری). */
    payerCardLast4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "چهار رقمِ آخرِ کارت باید عدد باشد.")
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از نشست.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) کارتِ مقصد باید پیکربندی شده باشد، وگرنه هیچ درخواستی نمی‌سازیم (fail-closed).
    const card = cardToCardInfo();
    if (!card) {
      return errorJson("پرداختِ کارت‌به‌کارت هنوز پیکربندی نشده است.", 503);
    }

    // ۳) اعتبارسنجیِ بدنه (مبلغ + کدِ پیگیری).
    const body = await parseJsonBody(request, cardTopupBodySchema);

    // ۴) ساختِ درخواستِ pending (بدونِ هیچ credit — تا تأییدِ ادمین).
    const req = await createPaymentRequest(user.id, {
      kind: "topup",
      amountToman: body.amountToman,
      referenceCode: body.referenceCode ?? null,
      payerCardLast4: body.payerCardLast4 ?? null,
      note: body.note ?? null,
    });

    return json(
      {
        ok: true,
        pending: true,
        request: {
          id: req.id,
          amountToman: req.amountToman,
          status: req.status,
          referenceCode: req.referenceCode,
          createdAt: req.createdAt,
        },
        card,
      },
      201,
    );
  });
}
