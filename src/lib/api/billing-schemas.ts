import "server-only";

/**
 * اسکیماهای zod برای ورودیِ خارجیِ مسیرهای بیلینگ (کیف‌پول/مصرف) — Track B.
 *
 * مثلِ بقیه‌ی مسیرها، هر ورودیِ بیرونی (کوئری/بدنه) پیش از لمسِ DB یا هسته‌ی بیلینگ
 * اینجا اعتبارسنجی می‌شود. این فایل عمداً جدا از `schemas.ts` است تا فایل‌های مالکیتیِ
 * Foundation دست‌نخورده بمانند و حوزه‌ی Track B خودبسنده باشد.
 *
 * نکته‌ی امنیتی (قاعده‌ی ۴ CONTEXT): هیچ‌کدام از این اسکیماها `userId` نمی‌گیرند —
 * کاربرِ هدف فقط از نشستِ احرازشده استخراج می‌شود، نه از ورودیِ قابلِ دستکاری.
 */
import { z } from "zod";

/**
 * کوئریِ GET /api/usage — فهرستِ صفحه‌بندی‌شده‌ی رکوردهای مصرفِ هوش مصنوعیِ کاربر.
 * کوئری‌پارامترها همیشه رشته‌اند؛ پس عدد را با coerce می‌سازیم.
 */
export const usageQuerySchema = z.object({
  /** فیلتر اختیاری روی نوعِ مصرف (تطبیق/انگیزه‌نامه/پردازشِ رزومه). */
  kind: z.enum(["match", "cover_letter", "resume_parse"]).optional(),
  /** صفحه‌بندی: حداکثر تعداد ردیف (۱..۱۰۰، پیش‌فرض ۲۰). */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** صفحه‌بندی: آفست (≥۰، پیش‌فرض ۰). */
  offset: z.coerce.number().int().min(0).default(0),
});

export type UsageQuery = z.infer<typeof usageQuerySchema>;

/**
 * کوئریِ GET /api/wallet — تعدادِ ردیف‌های اخیرِ دفتر برای نمایش (پیش‌فرض ۱۰).
 * صرفاً برای کنترلِ اندازه‌ی پاسخ؛ موجودی همیشه برمی‌گردد.
 */
export const walletQuerySchema = z.object({
  /** تعدادِ آخرین ردیف‌های دفترِ کیف‌پول (۱..۵۰، پیش‌فرض ۱۰). */
  ledgerLimit: z.coerce.number().int().min(1).max(50).default(10),
});

export type WalletQuery = z.infer<typeof walletQuerySchema>;

/** کمینه‌ی مبلغِ شارژِ دستی به تومان (جلوگیری از شارژهای بی‌معنیِ خرد). */
export const MIN_TOPUP_TOMAN = 10_000;
/** بیشینه‌ی مبلغِ شارژ در یک تراکنش (سقفِ ایمنیِ stub؛ درگاهِ واقعی سقفِ خود را دارد). */
export const MAX_TOPUP_TOMAN = 50_000_000;

/**
 * بدنه‌ی POST /api/wallet/topup — شارژِ دستیِ (DEV) کیف‌پول.
 *
 * ⚠️ این یک stub است: مبلغ را مستقیماً credit می‌کند بدونِ پرداختِ واقعی. جریانِ واقعیِ
 * Zarinpal (که 1xai هم پشتیبانی می‌کند) بعداً جای این را می‌گیرد؛ آن‌جا مبلغ پس از
 * تأییدِ درگاه credit می‌شود، نه از روی بدنه‌ی کلاینت.
 */
export const topupBodySchema = z.object({
  /** مبلغِ شارژ به تومان — عددِ صحیحِ مثبت در بازه‌ی مجاز. */
  amountToman: z.coerce
    .number()
    .int("مبلغ باید عددِ صحیح باشد.")
    .min(MIN_TOPUP_TOMAN, `حداقل مبلغِ شارژ ${MIN_TOPUP_TOMAN} تومان است.`)
    .max(MAX_TOPUP_TOMAN, `حداکثر مبلغِ شارژ ${MAX_TOPUP_TOMAN} تومان است.`),
});

export type TopupBody = z.infer<typeof topupBodySchema>;
