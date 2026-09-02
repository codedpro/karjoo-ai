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
  /**
   * Site job-CATEGORY slugs to target (Jobinja `machine_name` from
   * /api/v10/job/categories → `filters[job_categories][]`). This is the primary,
   * NON-AI targeting: the user picks categories the site offers and we apply to
   * every job in them. AI matching is a separate, optional premium filter on top.
   */
  categorySlugs?: string[];
  /** Site job-TYPE slugs (Jobinja `filters[job_types][]`). */
  jobTypes?: string[];
  /** Remote-only jobs (Jobinja `filters[remote]=1`). */
  remoteOnly?: boolean;
  /** Pause non-AI discovery/queueing for this user. */
  paused?: boolean;
  /** User-level queue cap per day for filter discovery. */
  dailyLimit?: number;
  /** User-level queue cap per week for filter discovery. */
  weeklyLimit?: number;
  /** Unlimited queueing for trusted/server-managed profiles; freshness filters still apply. */
  unlimitedApply?: boolean;
  /** Candidate gender for hard exclusion of gender-specific jobs. */
  gender?: "male" | "female" | "unspecified";
  /**
   * Result ordering (Jobinja `sort=`): "relevance_desc" | "published_at_desc"
   * (newest) | "salary_from_desc" (highest pay). Free-form to stay forward-compatible.
   */
  sort?: string;
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

export type JobBoardId =
  | "jobvision"
  | "jobinja"
  | "e-estekhdam"
  | "irantalent"
  | "karboom"
  | "linkedin"
  | "iranestekhdam"
  | "divar"
  | "quera"
  | "remoteok"
  | "weworkremotely"
  | "ponisha"
  | "parscoders"
  | "bankestekhdam";

/**
 * کانکتور یک سایت کاریابی. هر متد در پیاده‌سازی واقعی، احراز هویت و قوانین همان
 * سایت را رعایت می‌کند. اینجا فقط امضای قرارداد است.
 */
export interface JobBoardConnector {
  readonly id: JobBoardId;
  readonly displayName: string;
  /**
   * نوع اپلای این سایت:
   *   • `structured` — فرم/درخواست ساختاریافته (جابینجا، جاب‌ویژن).
   *   • `contact`    — اپلای = ارسال پیام/تماس از روی متن آگهی (ای‌استخدام و …).
   */
  readonly applyType: "structured" | "contact";
  /**
   * شکل نشست این سایت:
   *   • `cookie` — نشست در کوکی است (جابینجا) → `chrome.cookies`.
   *   • `token`  — توکن در localStorage/IndexedDB است (جاب‌ویژن SPA) → content script.
   */
  readonly sessionShape: "cookie" | "token";
  /**
   * ingestion عمومی و فقط-خواندنی برای کنترل‌پلین — بدون نیاز به نشست کاربر.
   * این از `apply()`ِ احرازهویت‌شده جداست: آگهی‌های عمومی را می‌خواند و نرمال می‌کند
   * تا موتور تطبیق رویشان کار کند. هیچ ریسک حسابی ندارد.
   */
  scrapePublic(prefs: JobPreferences): Promise<JobListing[]>;
  /** جست‌وجوی آگهی‌های مرتبط با ترجیحات کاربر. */
  search(prefs: JobPreferences): Promise<JobListing[]>;
  /** ارسال درخواست برای یک آگهی، با رزومه/انگیزه‌نامه‌ی آماده‌شده. */
  apply(job: JobListing, profile: CandidateProfile, coverLetter: string): Promise<ApplicationResult>;
}
