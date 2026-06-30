/**
 * اسکیمای zod برای خروجیِ ساخت‌یافته‌سازیِ رزومه با هوش مصنوعی (گیت‌وی 1xai).
 *
 * چرا اینجا (نه در src/lib/ai)؟ این اسکیما مخصوصِ Track A (رزومه → فیلد) است و در
 * ناحیه‌ی همین track می‌ماند تا با اسکیماهای مشترکِ موتورِ تطبیق (scoring) قاطی نشود.
 *
 * قاعده‌ی همیشگی: خروجی مدل «ورودیِ خارجی» است؛ هرگز به آن اعتماد نمی‌کنیم. هر پاسخی
 * که از گیت‌وی برمی‌گردد باید پیش از ذخیره/استفاده از این اسکیما بگذرد تا:
 *   • نوع‌ها تضمین شوند (مثلاً yearsExperience عددِ نامنفی، نه رشته/NaN)،
 *   • رشته‌های خالی/فاصله‌ای حذف یا نرمال شوند،
 *   • فیلدهای اضافیِ مدل دور ریخته شوند،
 *   • شکلِ خروجی با قراردادِ دامنه (CandidateProfile + نمایش UI) هم‌خوان بماند.
 *
 * این فایل عمداً «server-only» نیست: صرفاً تعریفِ اسکیماست و رازی ندارد؛ تا هم در
 * مسیرِ سرور و هم در تستِ واحد بدونِ اصطکاک قابلِ استفاده باشد.
 */
import { z } from "zod";

/**
 * رشته‌ی اختیاریِ نرمال‌شده: ابتدا trim می‌شود؛ خالی/فاصله‌ای → undefined (نه رشته‌ی
 * تهی) تا فیلدهای غایب در DB/UI null بمانند نه رشته‌ی خالی. غیررشته → undefined
 * (مدل گاهی null یا عدد می‌دهد؛ بی‌سروصدا نادیده می‌گیریم تا کلِ پارس نشکند).
 */
const optionalText = z
  .preprocess(
    (v) => (typeof v === "string" ? v.trim() : undefined),
    z.string().optional(),
  )
  .transform((v) => (v && v.length > 0 ? v : undefined));

/** یک ردیفِ سابقه‌ی کاری (هرکدام اختیاری چون رزومه‌ها ناهمگن‌اند). */
export const experienceSchema = z.object({
  /** عنوانِ شغلی/سمت. */
  title: optionalText,
  /** نامِ شرکت/سازمان. */
  company: optionalText,
  /** بازه‌ی زمانی به‌صورتِ متنِ آزاد (مثلِ «۱۳۹۸ تا ۱۴۰۱» یا «2019–2022»). */
  period: optionalText,
  /** خلاصه‌ی مسئولیت‌ها/دستاوردها. */
  summary: optionalText,
});

export type ResumeExperience = z.infer<typeof experienceSchema>;

/** یک ردیفِ تحصیلات. */
export const educationSchema = z.object({
  /** مقطع/مدرک (کارشناسی، کارشناسی ارشد، …). */
  degree: optionalText,
  /** رشته‌ی تحصیلی. */
  field: optionalText,
  /** نامِ دانشگاه/مؤسسه. */
  institution: optionalText,
  /** سالِ فارغ‌التحصیلی یا بازه (متنِ آزاد). */
  year: optionalText,
});

export type ResumeEducation = z.infer<typeof educationSchema>;

/**
 * خروجیِ کاملِ ساخت‌یافته‌سازیِ رزومه. همه‌ی فیلدها اختیاری‌اند: یک رزومه ممکن است
 * فقط بخشی از این‌ها را داشته باشد و مدل نباید مجبور به ساختنِ فیلدِ غایب شود (وگرنه
 * توهم می‌زند). اعدادِ نامعتبر/خارج‌ازبازه رد می‌شوند تا داده‌ی بد به DB نرسد.
 */
export const parsedResumeSchema = z.object({
  /** نام و نام‌خانوادگیِ کامل. */
  fullName: optionalText,
  /** عنوانِ حرفه‌ای/تخصص (headline). */
  headline: optionalText,
  /** شهرِ محلِ سکونت. */
  city: optionalText,
  /** ایمیلِ تماس (در صورتِ وجود؛ فقط برای نمایش به خودِ کاربر). */
  email: optionalText,
  /** شماره‌ی تماس (در صورتِ وجود؛ فقط برای نمایش به خودِ کاربر). */
  phone: optionalText,
  /** سال‌های سابقه‌ی کاری (عددِ نامنفیِ معقول). */
  yearsExperience: z
    .number()
    .int("سال‌های سابقه باید عددِ صحیح باشد")
    .min(0, "سال‌های سابقه نمی‌تواند منفی باشد")
    .max(60, "سال‌های سابقه نامعقول است")
    .optional(),
  /** فهرستِ مهارت‌ها — نرمال‌شده (trim، حذفِ خالی‌ها، حذفِ تکراری، سقفِ تعداد). */
  skills: z
    .array(z.string().trim().min(1))
    .max(60)
    .default([])
    .transform((arr) => Array.from(new Set(arr)).slice(0, 50)),
  /** سابقه‌ی کاری (سقفِ تعداد تا پرامپت/پاسخ بیش از حد بزرگ نشود). */
  experience: z.array(experienceSchema).max(30).default([]),
  /** تحصیلات. */
  education: z.array(educationSchema).max(20).default([]),
});

export type ParsedResume = z.infer<typeof parsedResumeSchema>;
