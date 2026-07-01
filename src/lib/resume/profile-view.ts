/**
 * شکلِ نمایشیِ پروفایل برای پاسخِ API + مصرفِ کلاینت (Track C, WF2).
 *
 * چرا فایلِ جدا؟ تا هم route پروفایل و هم route پارس *یک* شکلِ یکدست از پروفایل برگردانند
 * و فرمِ کلاینت بتواند بی‌واسطه آن را بخواند. خالص و بدونِ I/O (server-only نیست) تا در
 * تستِ واحد هم قابلِ استفاده باشد. هیچ ستونِ حساسی (resumeText/preferences) بیرون نمی‌دهد.
 */
import type {
  CandidateProfileRow,
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
} from "@/db/schema";

/** پروفایلِ جامع به شکلِ API/کلاینت — همه‌ی فیلدهای قابلِ ویرایش. */
export interface ApiFullProfile {
  fullName: string;
  headline: string | null;
  summary: string | null;
  city: string | null;
  phone: string | null;
  avatarUrl: string | null;
  expectedSalary: string | null;
  yearsExperience: number | null;
  skills: string[];
  workExperience: ProfileWorkExperience[];
  education: ProfileEducation[];
  languages: ProfileLanguage[];
  links: ProfileLink[];
}

/**
 * یک ردیفِ candidate_profiles را به شکلِ نمایشیِ API تبدیل می‌کند. آرایه‌های null (داده‌ی
 * legacy) به [] نرمال می‌شوند تا کلاینت همیشه آرایه ببیند.
 */
export function toApiProfile(row: CandidateProfileRow): ApiFullProfile {
  return {
    fullName: row.fullName,
    headline: row.headline ?? null,
    summary: row.summary ?? null,
    city: row.city ?? null,
    phone: row.phone ?? null,
    avatarUrl: row.avatarUrl ?? null,
    expectedSalary: row.expectedSalary ?? null,
    yearsExperience: row.yearsExperience ?? null,
    skills: row.skills ?? [],
    workExperience: row.workExperience ?? [],
    education: row.education ?? [],
    languages: row.languages ?? [],
    links: row.links ?? [],
  };
}
