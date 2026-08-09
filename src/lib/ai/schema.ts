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

/**
 * خروجیِ «رزومه‌ی سفارشیِ هر شغل» — محتوای بازنویسی‌شده‌ی رزومه، هدف‌گیری‌شده روی شرحِ آگهی.
 * قاعده‌ی سختی که در prompt هم می‌آید: هیچ چیزِ نادرست/جعلی اضافه نمی‌شود؛ فقط ترتیب/تأکید/
 * بازنویسیِ همان واقعیت‌های کاربر. عنوان‌ها انگلیسی/فارسی هرچه در داده‌ی کاربر بود.
 */
export const resumeTailorSchema = z.object({
  /** عنوانِ حرفه‌ایِ هدف‌گیری‌شده برای این نقش (مثلِ عنوانِ آگهی، منطبق با تجربه‌ی کاربر). */
  headline: z.string().min(1).max(160),
  /** خلاصه‌ی حرفه‌ایِ ۲–۴ جمله‌ای، بازنویسی‌شده برای این آگهی. */
  summary: z.string().min(1).max(1200),
  /** مهارت‌های مرتبط، *مرتب‌شده بر اساسِ ربط به آگهی* (زیرمجموعه‌ای از مهارت‌های واقعیِ کاربر). */
  skills: z.array(z.string().min(1).max(60)).max(40),
  /** تجربه‌های شغلی با bulletهای هدف‌گیری‌شده (بازنویسیِ همان نقش‌های واقعی). */
  experience: z
    .array(
      z.object({
        company: z.string().max(160).optional(),
        title: z.string().max(160).optional(),
        period: z.string().max(80).optional(),
        bullets: z.array(z.string().min(1).max(400)).max(8),
      }),
    )
    .max(12),
  /** ۲–۵ نکته‌ی برجسته/دستاورد که چرا این کاربر برای این نقش مناسب است. */
  highlights: z.array(z.string().min(1).max(300)).max(6).optional(),
});

export type ResumeTailorOutput = z.infer<typeof resumeTailorSchema>;


/**
 * نیازمندی‌های ساخت‌یافته‌ی یک آگهی — خروجیِ گامِ «تجزیه‌ی آگهی» (jd-requirements.ts).
 * عمداً فقط فهرست است: این گام دربارهٔ کاربر چیزی نمی‌داند و قضاوتی نمی‌کند.
 */
export const jdRequirementsSchema = z.object({
  /** تکنولوژی/ابزارهای نام‌برده‌شده (React، PostgreSQL، Docker …). */
  technologies: z.array(z.string().min(1).max(80)).max(60).default([]),
  /** مسئولیت‌های اصلیِ نقش. */
  responsibilities: z.array(z.string().min(1).max(200)).max(30).default([]),
  /** الزاماتِ غیرِفنی (سابقه‌ی مدیریتی، بنیان‌گذاری، زبان …). */
  qualifications: z.array(z.string().min(1).max(200)).max(30).default([]),
  /** سطحِ ارشدیت اگر آگهی گفته باشد. */
  seniority: z.string().max(60).optional(),
  /** حوزه‌ی نقش (مثلاً «full-stack»، «sales»، «devops»). */
  domain: z.string().max(60).optional(),
});

export type JdRequirements = z.infer<typeof jdRequirementsSchema>;


/**
 * فهرستِ مشتریان/کارفرمایانِ استخراج‌شده از **متنِ رزومه‌ی خودِ کاربر**.
 * منبع فقط همان متن است؛ این گام چیزی کشف یا پیشنهاد نمی‌کند.
 */
export const clientListSchema = z.object({
  clients: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        country: z.string().max(8).optional(),
        domain: z.string().max(60).optional(),
        work: z.string().max(160).optional(),
        year: z.number().int().min(1970).max(2100).optional(),
      }),
    )
    .max(60)
    .default([]),
});

export type ClientList = z.infer<typeof clientListSchema>;
