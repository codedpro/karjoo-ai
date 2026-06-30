import "server-only";

import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";

/**
 * کانکتور ایران‌تلنت (irantalent.com) — داربست.
 *
 * اپلایِ ساختاریافته (فرم/درخواست). شکلِ نشست هنوز قطعی نیست (کوکی یا توکن — بخش ۷
 * سند معماری: «TBD»)؛ تا روشن‌شدن روی یک حسابِ واقعی، فعلاً `cookie` درنظر گرفته شده
 * (محافظه‌کارانه؛ chrome.cookies). در صورتِ مشاهده‌ی توکن در localStorage باید به
 * `token` تغییر کند.
 *
 * هنوز هیچ اسکریپینگ/اتوماسیونی پیاده نشده است: scrapePublic/search/apply داربست‌اند.
 * این فایل صرفاً قراردادِ کانکتور را برآورده می‌کند تا رجیستری و ایمپورتِ پروفایل
 * بتوانند به آن ارجاع دهند.
 */
export const irantalent: JobBoardConnector = {
  id: "irantalent",
  displayName: "ایران‌تلنت",
  applyType: "structured",
  // شکلِ نشست TBD؛ تا روشن‌شدن روی حسابِ واقعی، محافظه‌کارانه cookie.
  sessionShape: "cookie",

  async scrapePublic(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("irantalent.scrapePublic: not implemented yet");
  },

  async search(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("irantalent.search: not implemented yet");
  },

  async apply(
    _job: JobListing,
    _profile: CandidateProfile,
    _coverLetter: string,
  ): Promise<ApplicationResult> {
    throw new Error("irantalent.apply: not implemented yet");
  },
};
