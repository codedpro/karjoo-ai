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
 * WF2 (پروفایلِ جامع): این اسکیما اکنون *همه‌ی* فیلدهایی را که بردهای ایرانی می‌پرسند
 * پوشش می‌دهد — خلاصه/درباره‌ی من، تلفن، سابقه‌ی کاری (با تاریخِ شروع/پایان/تاکنون)،
 * تحصیلات (با سالِ شروع/پایان)، زبان‌ها (نام + سطح)، حقوقِ درخواستی و لینک‌ها. شکلِ
 * آرایه‌ها *دقیقاً* با jsonbهای candidate_profiles هم‌راستاست تا persist بی‌واسطه باشد.
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

/**
 * بولینِ نرمال‌شده و اختیاری: مدل گاهی رشته‌ی "true"/"بله" می‌دهد. رشته‌های آشنا را
 * به boolean نگاشت می‌کنیم؛ هرچیزِ دیگر → undefined (بی‌سروصدا).
 */
const optionalBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "yes", "بله", "1", "current", "تاکنون", "تا کنون"].includes(t)) return true;
    if (["false", "no", "خیر", "0"].includes(t)) return false;
  }
  return undefined;
}, z.boolean().optional());

/**
 * یک ردیفِ سابقه‌ی کاری (هرکدام اختیاری چون رزومه‌ها ناهمگن‌اند). شکل با
 * ProfileWorkExperience (schema.ts دیتابیس) هم‌راستاست: company/title/startDate/
 * endDate/current/description.
 */
export const experienceSchema = z.object({
  /** عنوانِ شغلی/سمت. */
  title: optionalText,
  /** نامِ شرکت/سازمان. */
  company: optionalText,
  /** تاریخِ شروع (متنِ آزاد: «۱۳۹۸» یا «2019-03»). */
  startDate: optionalText,
  /** تاریخِ پایان (متنِ آزاد). اگر current=true، معمولاً خالی است. */
  endDate: optionalText,
  /** آیا هنوز مشغولِ این کار است (تا کنون). */
  current: optionalBool,
  /** خلاصه‌ی مسئولیت‌ها/دستاوردها. */
  description: optionalText,
});

export type ResumeExperience = z.infer<typeof experienceSchema>;

/**
 * یک ردیفِ تحصیلات. شکل با ProfileEducation هم‌راستاست: institution/degree/field/
 * startYear/endYear.
 */
export const educationSchema = z.object({
  /** مقطع/مدرک (کارشناسی، کارشناسی ارشد، …). */
  degree: optionalText,
  /** رشته‌ی تحصیلی. */
  field: optionalText,
  /** نامِ دانشگاه/مؤسسه. */
  institution: optionalText,
  /** سالِ شروع (متنِ آزاد). */
  startYear: optionalText,
  /** سالِ فارغ‌التحصیلی/پایان (متنِ آزاد). */
  endYear: optionalText,
});

export type ResumeEducation = z.infer<typeof educationSchema>;

/**
 * یک زبان + سطحِ تسلط. name «شناسه»ی این ردیف است؛ اما اینجا اختیاری تعریف شده تا یک
 * ردیفِ بدنام کلِ parse را نشکند — ردیف‌های بی‌نام بعداً در سطحِ آرایه فیلتر می‌شوند.
 */
export const languageSchema = z.object({
  /** نامِ زبان (فارسی/انگلیسی/…). */
  name: optionalText,
  /** سطحِ تسلط (متنِ آزاد: «مسلط»، «متوسط»، «C1»…). */
  level: optionalText,
});

export type RawResumeLanguage = z.infer<typeof languageSchema>;
/** زبانِ نرمال‌شده‌ی معتبر (name همیشه هست). */
export type ResumeLanguage = { name: string; level?: string };

/**
 * یک لینک (وب‌سایت/لینکدین/گیت‌هاب/…). url «شناسه»ی این ردیف است اما اختیاری تعریف شده
 * تا یک ردیفِ بدنام کلِ parse را نشکند — ردیف‌های بی‌url بعداً در سطحِ آرایه فیلتر می‌شوند.
 */
export const linkSchema = z.object({
  /** برچسبِ نمایشیِ لینک (اختیاری). */
  label: optionalText,
  /** آدرسِ لینک. */
  url: optionalText,
});

export type RawResumeLink = z.infer<typeof linkSchema>;
/** لینکِ نرمال‌شده‌ی معتبر (url همیشه هست). */
export type ResumeLink = { url: string; label?: string };

/**
 * خروجیِ کاملِ ساخت‌یافته‌سازیِ رزومه. همه‌ی فیلدها اختیاری‌اند: یک رزومه ممکن است
 * فقط بخشی از این‌ها را داشته باشد و مدل نباید مجبور به ساختنِ فیلدِ غایب شود (وگرنه
 * توهم می‌زند). اعدادِ نامعتبر/خارج‌ازبازه رد می‌شوند تا داده‌ی بد به DB نرسد.
 *
 * ردیف‌های آرایه‌ای که «کاملاً خالی»‌اند (همه‌ی فیلدهای معنادار undefined) پس از
 * اعتبارسنجی فیلتر می‌شوند تا نویزِ مدل به پروفایل نریزد.
 */
export const parsedResumeSchema = z.object({
  /** نام و نام‌خانوادگیِ کامل. */
  fullName: optionalText,
  /** عنوانِ حرفه‌ای/تخصص (headline). */
  headline: optionalText,
  /** «درباره‌ی من» / خلاصه‌ی حرفه‌ای. */
  summary: optionalText,
  /** شهرِ محلِ سکونت. */
  city: optionalText,
  /** ایمیلِ تماس (در صورتِ وجود؛ فقط برای نمایش به خودِ کاربر). */
  email: optionalText,
  /** شماره‌ی تماس (در صورتِ وجود؛ فقط برای نمایش به خودِ کاربر). */
  phone: optionalText,
  /** حقوقِ درخواستی (متنِ آزاد). */
  expectedSalary: optionalText,
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
  experience: z
    .array(experienceSchema)
    .max(30)
    .default([])
    .transform((rows) => rows.filter(isNonEmptyExperience)),
  /** تحصیلات. */
  education: z
    .array(educationSchema)
    .max(20)
    .default([])
    .transform((rows) => rows.filter(isNonEmptyEducation)),
  /** زبان‌ها — ردیف‌های بی‌نام فیلتر می‌شوند (name شناسه‌ی معتبر است). */
  languages: z
    .array(languageSchema)
    .max(20)
    .default([])
    .transform((rows): ResumeLanguage[] => {
      const out: ResumeLanguage[] = [];
      for (const r of rows) {
        if (!r.name) continue;
        out.push({ name: r.name, ...(r.level ? { level: r.level } : {}) });
      }
      return out;
    }),
  /** لینک‌ها — ردیف‌های بی‌url فیلتر می‌شوند (url شناسه‌ی معتبر است). */
  links: z
    .array(linkSchema)
    .max(15)
    .default([])
    .transform((rows): ResumeLink[] => {
      const out: ResumeLink[] = [];
      for (const r of rows) {
        if (!r.url) continue;
        out.push({ url: r.url, ...(r.label ? { label: r.label } : {}) });
      }
      return out;
    }),
});

export type ParsedResume = z.infer<typeof parsedResumeSchema>;

/** آیا این ردیفِ سابقه‌ی کاری دستِ‌کم یک فیلدِ معنادار دارد؟ */
function isNonEmptyExperience(e: ResumeExperience): boolean {
  return Boolean(e.title || e.company || e.startDate || e.endDate || e.description);
}

/** آیا این ردیفِ تحصیلات دستِ‌کم یک فیلدِ معنادار دارد؟ */
function isNonEmptyEducation(e: ResumeEducation): boolean {
  return Boolean(e.degree || e.field || e.institution || e.startYear || e.endYear);
}
