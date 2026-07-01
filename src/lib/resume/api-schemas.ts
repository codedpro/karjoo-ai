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

/** بدنه‌ی POST /api/resume/primary — یک فایلِ آپلودشده را «رزومه‌ی اصلی» می‌کند (رایگان). */
export const resumeSetPrimarySchema = z.object({
  resumeFileId: z.string().uuid("resumeFileId باید UUID معتبر باشد"),
});

export type ResumeSetPrimaryBody = z.infer<typeof resumeSetPrimarySchema>;

/** بدنه‌ی DELETE /api/resume/file — حذفِ یک فایلِ آپلودشده (رکورد + دیسک). */
export const resumeDeleteFileSchema = z.object({
  resumeFileId: z.string().uuid("resumeFileId باید UUID معتبر باشد"),
});

export type ResumeDeleteFileBody = z.infer<typeof resumeDeleteFileSchema>;

/* ─────────────────  زیر-اسکیماهای آرایه‌ایِ پروفایلِ جامع (WF2)  ───────────── */
/*
 * شکلِ این‌ها *دقیقاً* با jsonbهای candidate_profiles (ProfileWorkExperience/
 * ProfileEducation/ProfileLanguage/ProfileLink) هم‌راستاست تا ذخیره بی‌واسطه باشد.
 * همه‌ی متن‌ها trim می‌شوند؛ رشته‌ی خالی → در سرویس حذف می‌شود. سقفِ طول‌ها محافظه‌کارانه است.
 */

/** رشته‌ی متنیِ کوتاهِ اختیاری (trim، سقفِ طول). */
const shortText = (max: number) => z.string().trim().max(max);

/** یک ردیفِ سابقه‌ی کاری. */
export const workExperienceItemSchema = z.object({
  company: shortText(200).optional(),
  title: shortText(200).optional(),
  startDate: shortText(40).optional(),
  endDate: shortText(40).optional(),
  current: z.boolean().optional(),
  description: shortText(2000).optional(),
});

/** یک ردیفِ تحصیلات. */
export const educationItemSchema = z.object({
  institution: shortText(200).optional(),
  degree: shortText(120).optional(),
  field: shortText(200).optional(),
  startYear: shortText(20).optional(),
  endYear: shortText(20).optional(),
});

/** یک زبان + سطح. name اجباری است (ردیفِ بی‌نام معنا ندارد). */
export const languageItemSchema = z.object({
  name: z.string().trim().min(1, "نامِ زبان لازم است").max(80),
  level: shortText(60).optional(),
});

/** یک لینک. url اجباری است (ردیفِ بی‌url معنا ندارد). */
export const linkItemSchema = z.object({
  label: shortText(80).optional(),
  url: z.string().trim().min(1, "آدرسِ لینک لازم است").max(500),
});

/**
 * بدنه‌ی PATCH /api/resume/profile — ذخیره‌ی نسخه‌ی ویرایش‌شده‌ی کاربر روی پروفایل.
 *
 * کاربر پس از دیدنِ فیلدهای استخراج‌شده‌ی AI (یا دستی) می‌تواند *همه‌ی* فیلدهای پروفایلِ
 * جامع را ویرایش کند و ذخیره بزند. این مسیر مستقل از AI است؛ فیلدها را روی
 * candidate_profiles می‌نشاند (به نشست مقید). فقط fullName اجباری است؛ بقیه اختیاری‌اند
 * تا ویرایشِ جزئی ممکن باشد. آرایه‌ها با default [] می‌آیند تا حذفِ همه‌ی ردیف‌ها هم ممکن باشد.
 *
 * WF2 (پروفایلِ جامع): علاوه بر فیلدهای پایه، عکس/خلاصه/تلفن/حقوق/سابقه/تحصیلات/زبان/لینک.
 */
export const resumeProfileSaveSchema = z.object({
  fullName: z.string().trim().min(1, "نام نمی‌تواند خالی باشد").max(200),
  headline: shortText(200).nullish(),
  summary: shortText(3000).nullish(),
  city: shortText(100).nullish(),
  phone: shortText(40).nullish(),
  avatarUrl: shortText(1000).nullish(),
  expectedSalary: shortText(120).nullish(),
  yearsExperience: z.number().int().min(0).max(60).nullish(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  workExperience: z.array(workExperienceItemSchema).max(30).default([]),
  education: z.array(educationItemSchema).max(20).default([]),
  languages: z.array(languageItemSchema).max(20).default([]),
  links: z.array(linkItemSchema).max(15).default([]),
});

export type ResumeProfileSaveBody = z.infer<typeof resumeProfileSaveSchema>;
