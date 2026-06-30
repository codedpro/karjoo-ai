/**
 * اسکیمای اعتبارسنجیِ بدنه‌ی تنظیماتِ هوش مصنوعی (Track A).
 *
 * عمداً «server-only» نیست: فقط تعریفِ zod (بدونِ راز/I/O) تا هم در route و هم در
 * تستِ واحد بدونِ اصطکاک استفاده شود. بدنه فقط modelId می‌گیرد — provider از خودِ
 * کاتالوگ مشتق می‌شود (نه از کلاینت)، و userId هرگز از بدنه گرفته نمی‌شود (§10).
 */
import { z } from "zod";

/** بدنه‌ی PUT /api/ai-settings — تنها modelId (رشته‌ی غیرخالی، طولِ معقول). */
export const updateAiSettingsBodySchema = z.object({
  modelId: z.string().trim().min(1, "modelId لازم است").max(128),
});

export type UpdateAiSettingsBody = z.infer<typeof updateAiSettingsBodySchema>;
