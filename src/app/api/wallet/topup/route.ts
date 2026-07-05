import "server-only";

/**
 * POST /api/wallet/topup — شارژِ کیف‌پولِ کاربرِ احرازشده (نشستِ وب).
 *
 * ⚠️⚠️ این یک STUB توسعه‌ای است (نه پرداختِ واقعی). ⚠️⚠️
 * مبلغِ بدنه را مستقیماً به کیف‌پول credit می‌کند تا در توسعه/دمو بتوان موجودی ساخت و
 * مسیرهای پولیِ AI را آزمود. هیچ پولی واقعاً دریافت نمی‌شود.
 *
 * مسیرِ واقعی (Zarinpal — که 1xai هم پشتیبانی می‌کند):
 *   ۱) POST /api/wallet/topup  → یک تراکنشِ pending می‌سازد و کاربر را به درگاه می‌فرستد
 *      (PaymentRequest → authority → redirect به startpay).
 *   ۲) callback از درگاه → PaymentVerify(authority, amount) → فقط در صورتِ تأییدِ موفق،
 *      همین `credit(...)` صدا زده می‌شود (با refType='zarinpal'، refId=ref_id درگاه).
 *   credit/ledger همان هسته‌ی Foundation است؛ فقط «منشأِ تأیید» عوض می‌شود. درزِ زیر
 *   (`recordTopup`) همان نقطه‌ای است که جریانِ واقعی پس از verify صدا می‌زند.
 *
 * امنیت (قاعده‌ی ۴): کاربرِ هدف از کوکیِ نشست است؛ مبلغ از بدنه اعتبارسنجی و سقف‌گذاری
 * می‌شود. در نسخه‌ی واقعی مبلغِ معتبر از پاسخِ درگاه می‌آید، نه از بدنه‌ی کلاینت.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { topupBodySchema } from "@/lib/api/billing-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { credit } from "@/lib/billing/wallet";
import { isDevBillingEnabled } from "@/lib/env";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از کوکیِ نشست.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۱.۵) گیتِ استابِ آزمایشی (fail-closed): بدونِ KARJOO_DEV_BILLING="1" این مسیر
    //      رد می‌شود تا در پرود هیچ‌کس نتواند رایگان به کیف‌پولش اعتبار بریزد.
    if (!isDevBillingEnabled()) {
      return errorJson("شارژِ کیف‌پول هنوز فعال نیست", 403);
    }

    // ۲) اعتبارسنجی + سقف‌گذاریِ مبلغ (۴۰۰ در صورتِ نامعتبر).
    const { amountToman } = await parseJsonBody(request, topupBodySchema);

    // ۳) شارژِ کیف‌پول از طریقِ هسته‌ی بیلینگ (credit + ردیفِ دفتر، اتمیک).
    //    TODO(zarinpal): این را پشتِ verify-callbackِ درگاه ببر؛ فعلاً DEV-stub.
    const result = await recordTopup(user.id, amountToman);

    return json(
      {
        ok: true,
        // به کلاینت اعلام می‌کنیم این شارژِ آزمایشی است (نه پرداختِ واقعی).
        dev: true,
        balanceToman: result.balanceToman,
        creditedToman: amountToman,
        ledgerId: result.ledgerId,
      },
      201,
    );
  });
}

/**
 * درزِ ثبتِ شارژ — تنها نقطه‌ای که موجودی را افزایش می‌دهد. در stubِ فعلی مستقیم
 * credit می‌کند؛ جریانِ واقعیِ Zarinpal *همین* را پس از تأییدِ موفقِ درگاه صدا می‌زند
 * (با refType/refIdِ تراکنشِ درگاه). نگه‌داشتنِ آن به‌صورتِ یک تابعِ کوچک، مهاجرت به
 * پرداختِ واقعی را به یک تغییرِ موضعی محدود می‌کند.
 */
async function recordTopup(userId: string, amountToman: number) {
  return credit(userId, "topup", amountToman, {
    refType: "dev_topup",
    description: "شارژِ آزمایشیِ کیف‌پول (DEV)",
  });
}
