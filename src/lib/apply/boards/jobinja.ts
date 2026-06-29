import "server-only";

import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";

/**
 * کانکتور جابینجا (jobinja.ir) — داربست.
 *
 * TODO: احراز هویت کاربر، جست‌وجوی آگهی‌ها و ارسال درخواست مطابق با شرایط استفاده‌ی
 * جابینجا. هیچ اسکریپینگ/اتوماسیونی هنوز پیاده نشده است.
 */
export const jobinja: JobBoardConnector = {
  id: "jobinja",
  displayName: "جابینجا",

  async search(_prefs: JobPreferences): Promise<JobListing[]> {
    throw new Error("jobinja.search: not implemented yet");
  },

  async apply(
    _job: JobListing,
    _profile: CandidateProfile,
    _coverLetter: string,
  ): Promise<ApplicationResult> {
    throw new Error("jobinja.apply: not implemented yet");
  },
};
