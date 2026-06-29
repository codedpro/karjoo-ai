import "server-only";

import { jobinja } from "@/lib/apply/boards/jobinja";
import { jobvision } from "@/lib/apply/boards/jobvision";
import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobBoardId,
  JobListing,
} from "@/lib/apply/types";

/** ثبت کانکتورها — افزودن سایت کاریابی تازه = یک ورودی اینجا. */
export const connectors: Record<string, JobBoardConnector> = {
  [jobvision.id]: jobvision,
  [jobinja.id]: jobinja,
  // TODO: e-estekhdam, karboom, linkedin
};

export function getConnector(id: JobBoardId): JobBoardConnector | undefined {
  return connectors[id];
}

/**
 * موتور تطبیق هوش مصنوعی — داربست.
 *
 * در پیاده‌سازی واقعی: آگهی و پروفایل کاربر را به یک مدل می‌دهد، امتیاز تطبیق و
 * یک انگیزه‌نامه‌ی اختصاصی تولید می‌کند. (مدل و کلید از طریق گیت‌وی 1xai تأمین می‌شود.)
 */
export async function scoreAndDraft(
  _job: JobListing,
  _profile: CandidateProfile,
): Promise<{ matchScore: number; coverLetter: string }> {
  throw new Error("scoreAndDraft (AI matching) not implemented yet");
}

/**
 * گردش‌کار «اپلای خودکار» (اسکلت):
 *   ۱) جست‌وجوی آگهی‌ها در هر سایت فعال
 *   ۲) امتیازدهی هوش مصنوعی + نگارش انگیزه‌نامه
 *   ۳) اپلای روی آگهی‌هایی که از آستانه‌ی تطبیق عبور می‌کنند
 *
 * هنوز هیچ اتوماسیونی اجرا نمی‌شود — صرفاً ساختار را مشخص می‌کند.
 */
export async function runAutoApply(
  _profile: CandidateProfile,
  _boards: JobBoardId[],
): Promise<ApplicationResult[]> {
  throw new Error("runAutoApply pipeline not implemented yet");
}

export type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobBoardId,
  JobListing,
} from "@/lib/apply/types";
