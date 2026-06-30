import "server-only";

/**
 * اسکیماهای zod برای ورودیِ خارجیِ مسیرهای پلن (`/api/me/plan`) — Track A.
 *
 * مثلِ بقیه‌ی مسیرها، هر ورودیِ بیرونی پیش از لمسِ DB/هسته اینجا اعتبارسنجی می‌شود.
 * این فایل عمداً جدا از `schemas.ts`/`billing-schemas.ts` است تا فایل‌های مالکیتیِ
 * Foundation یا حوزه‌ی Track B دست‌نخورده بمانند و حوزه‌ی Track A خودبسنده باشد.
 *
 * نکته‌ی امنیتی (قاعده‌ی ۴ CONTEXT): اسکیما `userId` نمی‌گیرد — کاربرِ هدف فقط از نشستِ
 * احرازشده می‌آید، نه از بدنه. فقط کلیدِ پلن (یکی از پلن‌های فعالِ فروختنی) پذیرفته
 * می‌شود؛ مقادیرِ تاریخیِ planEnum (payg/premium) عمداً اینجا قابلِ انتخاب نیستند.
 */
import { z } from "zod";

/** کلیدهای پلنِ فعالِ قابلِ انتخاب (هم‌راستا با PlanKey در plans.ts). */
export const SELECTABLE_PLAN_KEYS = ["free", "pro", "max", "maxplus"] as const;

/**
 * بدنه‌ی POST /api/me/plan — تغییرِ پلنِ کاربر.
 *
 * فقط کلیدِ یک پلنِ فعال پذیرفته می‌شود. در حالتِ DEV این مستقیماً users.plan را تنظیم
 * می‌کند و در صورتِ ارتقا grantMonthlyCredits را اعمال می‌کند؛ مسیرِ پرداختِ واقعی
 * (زرین‌پال) بعداً جای این را می‌گیرد.
 */
export const changePlanBodySchema = z.object({
  /** کلیدِ پلنِ مقصد — یکی از پلن‌های فعالِ فروختنی. */
  plan: z.enum(SELECTABLE_PLAN_KEYS, {
    message: "پلنِ نامعتبر است.",
  }),
});

export type ChangePlanBody = z.infer<typeof changePlanBodySchema>;
