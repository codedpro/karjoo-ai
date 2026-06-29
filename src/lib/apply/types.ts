/**
 * قراردادهای دامنه‌ی «اپلای خودکار» کارجو.
 *
 * این لایه عمداً مستقل از پلتفرم است: هر سایت کاریابی (جاب‌ویژن، جابینجا و …) یک
 * کانکتور می‌سازد که این اینترفیس را پیاده می‌کند. منطق هوش مصنوعی (تطبیق شغل،
 * نگارش رزومه/انگیزه‌نامه) بالای این قرارداد می‌نشیند و به جزئیات هیچ سایتی وابسته نیست.
 *
 * وضعیت: داربست (scaffold). هیچ اتوماسیون واقعی‌ای اینجا پیاده نشده است.
 */

/** پروفایل کارجوی کاربر — ورودی موتور تطبیق. */
export interface CandidateProfile {
  fullName: string;
  headline?: string;
  skills: string[];
  yearsExperience?: number;
  city?: string;
  /** متن خام رزومه یا خلاصه‌ی حرفه‌ای. */
  resumeText?: string;
  /** ترجیحات کاربر برای فیلتر کردن آگهی‌ها. */
  preferences?: JobPreferences;
}

export interface JobPreferences {
  titles?: string[];
  cities?: string[];
  minSalary?: number;
  employmentTypes?: ("full-time" | "part-time" | "remote" | "contract" | "internship")[];
}

/** یک آگهی شغلی نرمال‌شده از هر سایت کاریابی. */
export interface JobListing {
  /** شناسه‌ی یکتا در سطح کل سیستم: `${board}:${externalId}`. */
  id: string;
  board: JobBoardId;
  externalId: string;
  title: string;
  company?: string;
  city?: string;
  url: string;
  description?: string;
  salary?: string;
  postedAt?: string;
}

/** نتیجه‌ی تلاش برای اپلای روی یک آگهی. */
export interface ApplicationResult {
  job: JobListing;
  status: "submitted" | "skipped" | "failed";
  /** امتیاز تطبیق (۰ تا ۱) که موتور هوش مصنوعی محاسبه کرده. */
  matchScore?: number;
  /** انگیزه‌نامه‌ی تولیدشده برای این آگهی. */
  coverLetter?: string;
  reason?: string;
  submittedAt?: string;
}

export type JobBoardId = "jobvision" | "jobinja" | "e-estekhdam" | "karboom" | "linkedin";

/**
 * کانکتور یک سایت کاریابی. هر متد در پیاده‌سازی واقعی، احراز هویت و قوانین همان
 * سایت را رعایت می‌کند. اینجا فقط امضای قرارداد است.
 */
export interface JobBoardConnector {
  readonly id: JobBoardId;
  readonly displayName: string;
  /** جست‌وجوی آگهی‌های مرتبط با ترجیحات کاربر. */
  search(prefs: JobPreferences): Promise<JobListing[]>;
  /** ارسال درخواست برای یک آگهی، با رزومه/انگیزه‌نامه‌ی آماده‌شده. */
  apply(job: JobListing, profile: CandidateProfile, coverLetter: string): Promise<ApplicationResult>;
}
