import "server-only";

import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";

/**
 * کانکتور ای‌استخدام (e-estekhdam.com) — داربست.
 *
 * نوعِ اپلایِ این سایت «تماس» است: در بیشترِ آگهی‌ها، «اپلای» یعنی ارسالِ پیام/تماس
 * از روی اطلاعاتِ متنِ آگهی، نه یک فرمِ ساختاریافته (بخش ۷ سند معماری). نشست — در
 * صورتِ نیاز — کوکی است.
 *
 * هنوز هیچ اسکریپینگ/اتوماسیونی پیاده نشده است: scrapePublic/search/apply داربست‌اند
 * و در فازهای بعد (با رعایتِ robots.txt و شرایطِ استفاده) پیاده می‌شوند. این فایل صرفاً
 * قراردادِ کانکتور را برآورده می‌کند تا رجیستری و ایمپورتِ پروفایل بتوانند به آن ارجاع دهند.
 */
export const eEstekhdam: JobBoardConnector = {
  id: "e-estekhdam",
  displayName: "ای‌استخدام",
  // اپلای = پیام/تماس از روی متنِ آگهی (نه فرمِ ساختاریافته).
  applyType: "contact",
  sessionShape: "cookie",

  async scrapePublic(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("e-estekhdam.scrapePublic: not implemented yet");
  },

  async search(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("e-estekhdam.search: not implemented yet");
  },

  async apply(
    _job: JobListing,
    _profile: CandidateProfile,
    _coverLetter: string,
  ): Promise<ApplicationResult> {
    throw new Error("e-estekhdam.apply: not implemented yet");
  },
};
