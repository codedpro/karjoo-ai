/**
 * اسکیمای اعتبارسنجیِ بدنه‌ی «اپلای خودکارِ سرور» (Track B).
 *
 * سطحِ *سرور* (پَسیو، ناوگانِ ۲۴/۷) — جدا و مستقل از تاگلِ افزونه. عمداً «server-only»
 * نیست: فقط تعریفِ zod (بدونِ راز/I/O) تا هم در route و هم در تستِ واحد استفاده شود.
 * بدنه فقط { enabled, minScore? } می‌گیرد؛ userId هرگز از بدنه گرفته نمی‌شود — سرور آن
 * را از نشست می‌گیرد (قاعده‌ی ۴/§۱۰). پلن‌گِیت (Max/Max+) در خودِ route اعمال می‌شود،
 * نه اینجا (این لایه فقط شکلِ بدنه را می‌سنجد).
 *
 * هر دو فیلد اختیاری‌اند تا UI بتواند فقط تاگل یا فقط آستانه را به‌روزرسانی کند؛ اما
 * بدنه‌ی کاملاً خالی نامعتبر است (چیزی برای تغییر نیست). minScore به بازه‌ی [۰، ۱] مهار
 * می‌شود (همان دامنه‌ی schema default 0.7).
 */
import { z } from "zod";

/**
 * بدنه‌ی PUT /api/server-auto-apply.
 *   • enabled  — تاگلِ رضایتِ سطحِ سرور (روشن/خاموش). اختیاری.
 *   • minScore — آستانه‌ی امتیازِ تطبیق در بازه‌ی [۰، ۱]. اختیاری.
 * دستِ‌کم یکی از دو فیلد باید حاضر باشد (وگرنه چیزی برای تغییر نیست → ۴۰۰).
 */
export const updateServerAutoApplyBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    minScore: z
      .number({ error: "minScore باید عدد باشد" })
      .min(0, "minScore نمی‌تواند کمتر از ۰ باشد")
      .max(1, "minScore نمی‌تواند بیشتر از ۱ باشد")
      .optional(),
  })
  .refine((b) => b.enabled !== undefined || b.minScore !== undefined, {
    message: "دستِ‌کم یکی از enabled یا minScore لازم است",
  });

export type UpdateServerAutoApplyBody = z.infer<
  typeof updateServerAutoApplyBodySchema
>;
