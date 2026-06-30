/**
 * اسکیماهای zod برای ورودیِ مسیرهای API رزومه (Track A, WF1).
 *
 * هر چیزی که از کلاینت می‌آید پیش از لمسِ DB/دیسک/AI اینجا اعتبارسنجی می‌شود.
 * این فایل عمداً server-only نیست تا در تستِ واحد هم قابلِ استفاده باشد.
 */
import { z } from "zod";

/**
 * بدنه‌ی JSONِ آپلودِ base64 (مسیرِ جایگزینِ multipart).
 * `data` همان محتوای PDF به‌صورتِ base64 است (با یا بدونِ پیشوندِ data: URL).
 */
export const resumeUploadJsonSchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  /** محتوای PDF به‌صورتِ base64 (ممکن است شاملِ پیشوندِ `data:application/pdf;base64,` باشد). */
  data: z.string().min(1, "محتوای فایل خالی است"),
});

export type ResumeUploadJson = z.infer<typeof resumeUploadJsonSchema>;

/** بدنه‌ی POST /api/resume/parse — یک رکوردِ resume_files را با AI پردازش می‌کند. */
export const resumeParseSchema = z.object({
  resumeFileId: z.string().uuid("resumeFileId باید UUID معتبر باشد"),
});

export type ResumeParseBody = z.infer<typeof resumeParseSchema>;

/**
 * بدنه‌ی PATCH /api/resume/profile — ذخیره‌ی نسخه‌ی ویرایش‌شده‌ی کاربر روی پروفایل.
 *
 * کاربر پس از دیدنِ فیلدهای استخراج‌شده‌ی AI می‌تواند آن‌ها را تصحیح کند و ذخیره بزند.
 * این مسیر مستقل از AI است؛ فقط فیلدهای پروفایل را روی candidate_profiles می‌نشاند
 * (به نشست مقید). همه اختیاری‌اند تا ویرایشِ جزئی ممکن باشد.
 */
export const resumeProfileSaveSchema = z.object({
  fullName: z.string().trim().min(1, "نام نمی‌تواند خالی باشد").max(200),
  headline: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  yearsExperience: z
    .number()
    .int()
    .min(0)
    .max(60)
    .nullish(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
});

export type ResumeProfileSaveBody = z.infer<typeof resumeProfileSaveSchema>;
