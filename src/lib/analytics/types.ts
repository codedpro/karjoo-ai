/**
 * تایپ‌های مشترکِ آنالیتیکس — کوچک نگه داشته شده تا هم کدِ کلاینت و هم سرور
 * بتوانند بدونِ کشیدنِ SDKها آن را import کنند.
 *
 * کارجو تک‌مستأجر (single-tenant) است: نامِ مستأجر همیشه ثابتِ 'karjoo' است — هیچ
 * منطقِ چندبرندی نداریم. مقدارِ مستأجر با تگِ `tenant` در Sentry هم‌راستا است.
 */

/** نامِ ثابتِ مستأجر — با تگِ Sentry (`tenant: 'karjoo'`) یکسان. */
export const TENANT = "karjoo" as const;

/** خصیصه‌های سریال‌پذیرِ یک رویداد. */
export type EventProps = Record<string, string | number | boolean | null | undefined>;

/** خصیصه‌های شناساییِ کاربر (identify). */
export interface IdentifyProps extends EventProps {
  email?: string;
  name?: string;
}

/**
 * نام‌های قانونیِ رویداد. رویدادِ تازه را همین‌جا اضافه کنید — نه به‌صورتِ رشته‌ی
 * درون‌خطی — تا بتوان همه‌ی نقاطِ تماس را یک‌جا grep کرد و داشبوردهای PostHog بین
 * انتشارها ثابت بمانند.
 */
export const EVENTS = {
  /** ورودِ موفقِ کاربر (کال‌بکِ Google، پس از صدورِ نشستِ وب). */
  LOGIN: "login",
  /** آپلودِ فایلِ رزومه (PDF) توسطِ کاربر. */
  RESUME_UPLOADED: "resume_uploaded",
  /** ساخت‌یافته‌سازیِ رزومه با هوش مصنوعی (parse موفق). */
  AI_PARSE: "ai_parse",
  /** روشن‌شدنِ اپلای خودکار (تاگلِ auto-apply → enabled). */
  APPLY_ENABLED: "apply_enabled",
  /** پروبِ همگام‌سازیِ مشاهده‌پذیری (اندپوینتِ obs-smoke). */
  OBS_SMOKE: "obs_smoke",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
