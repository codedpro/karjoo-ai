/**
 * اسکیمای اعتبارسنجیِ بدنه‌ی «اپلای خودکار» (Track A).
 *
 * عمداً «server-only» نیست: فقط تعریفِ zod (بدونِ راز/I/O) تا هم در route و هم در
 * تستِ واحد بدونِ اصطکاک استفاده شود. بدنه فقط { enabled, minScore? } می‌گیرد؛
 * userId هرگز از بدنه گرفته نمی‌شود — سرور آن را از نشست می‌گیرد (قاعده‌ی ۴/§۱۰).
 *
 * هر دو فیلد اختیاری‌اند تا UI بتواند فقط تاگل یا فقط آستانه را به‌روزرسانی کند؛ اما
 * بدنه‌ی کاملاً خالی نامعتبر است (چیزی برای تغییر نیست). minScore به بازه‌ی [۰، ۱] مهار
 * می‌شود (همان دامنه‌ی schema default 0.7) تا هرگز آستانه‌ی بی‌معنا ذخیره نشود.
 */
import { z } from "zod";

/**
 * بدنه‌ی PUT /api/auto-apply.
 *   • enabled  — تاگلِ رضایت (روشن/خاموش). اختیاری.
 *   • minScore — آستانه‌ی امتیازِ تطبیق در بازه‌ی [۰، ۱]. اختیاری.
 * دستِ‌کم یکی از دو فیلد باید حاضر باشد (وگرنه چیزی برای تغییر نیست → ۴۰۰).
 */
export const updateAutoApplyBodySchema = z
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

export type UpdateAutoApplyBody = z.infer<typeof updateAutoApplyBodySchema>;
