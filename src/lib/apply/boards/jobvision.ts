import "server-only";

import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";

/**
 * کانکتور جاب‌ویژن (jobvision.ir) — داربست.
 *
 * TODO: احراز هویت کاربر، جست‌وجوی آگهی‌ها و ارسال درخواست مطابق با شرایط استفاده‌ی
 * جاب‌ویژن. هیچ اسکریپینگ/اتوماسیونی هنوز پیاده نشده است.
 */
export const jobvision: JobBoardConnector = {
  id: "jobvision",
  displayName: "جاب‌ویژن",

  async search(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("jobvision.search: not implemented yet");
  },

  async apply(
    _job: JobListing,
    _profile: CandidateProfile,
    _coverLetter: string,
  ): Promise<ApplicationResult> {
    throw new Error("jobvision.apply: not implemented yet");
  },
};
