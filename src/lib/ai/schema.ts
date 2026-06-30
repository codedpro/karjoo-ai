/**
 * اسکیماهای zod برای خروجی‌های مدل هوش مصنوعی (گیت‌وی 1xai).
 *
 * چرا اینجا؟ خروجی مدل «ورودی خارجی» است؛ هرگز به آن اعتماد نمی‌کنیم. هر پاسخی که
 * از گیت‌وی برمی‌گردد باید پیش از استفاده از این اسکیماها بگذرد تا:
 *   • نوع‌ها تضمین شوند (matchScore عددی در بازهٔ ۰..۱، نه رشته یا NaN)،
 *   • فیلدهای اضافیِ مدل دور ریخته شوند،
 *   • شکل خروجی با قرارداد دامنه (`scoreAndDraft`) هم‌خوان بماند.
 *
 * این فایل عمداً «server-only» نیست: صرفاً تعریف اسکیماست و رازی ندارد، تا هم در
 * مسیر سرور و هم در تست‌های واحد بدون اصطکاک قابل استفاده باشد.
 */
import { z } from "zod";

/**
 * خروجی امتیازدهی تطبیق شغل.
 *   • `matchScore` — عدد ۰ تا ۱ (۰ = بی‌ربط، ۱ = تطبیق کامل).
 *   • `reasons` — دلایل کوتاهِ فارسی که چرا این امتیاز داده شده (برای شفافیت کاربر).
 */
export const matchScoreSchema = z.object({
  matchScore: z
    .number({ message: "matchScore باید عددی بین ۰ و ۱ باشد" })
    .min(0, "matchScore نمی‌تواند کمتر از ۰ باشد")
    .max(1, "matchScore نمی‌تواند بیشتر از ۱ باشد"),
  reasons: z
    .array(z.string().trim().min(1))
    .max(8)
    .default([]),
});

export type MatchScoreOutput = z.infer<typeof matchScoreSchema>;

/**
 * خروجی نگارش انگیزه‌نامه (cover letter / انگیزه‌نامه).
 *   • `coverLetter` — متن آمادهٔ ارسال؛ نباید خالی باشد.
 */
export const coverLetterSchema = z.object({
  coverLetter: z
    .string({ message: "coverLetter باید رشته باشد" })
    .trim()
    .min(1, "انگیزه‌نامه نمی‌تواند خالی باشد"),
});

export type CoverLetterOutput = z.infer<typeof coverLetterSchema>;

/**
 * خروجی ترکیبیِ یک‌مرحله‌ای (امتیاز + انگیزه‌نامه) — برای حالتی که می‌خواهیم هر دو را
 * در یک فراخوانیِ مدل بگیریم و هزینه/تأخیر را نصف کنیم. `scoreAndDraft` از این استفاده می‌کند.
 */
export const scoreAndDraftSchema = z.object({
  matchScore: matchScoreSchema.shape.matchScore,
  reasons: matchScoreSchema.shape.reasons,
  coverLetter: coverLetterSchema.shape.coverLetter,
});

export type ScoreAndDraftOutput = z.infer<typeof scoreAndDraftSchema>;
