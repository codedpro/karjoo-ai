import "server-only";

/**
 * داده‌ی صفحه‌ی «رزومه و پروفایل» — مستقیم از DB (server-side، الگوی RSC، Track C).
 *
 * فقط-خواندنی و به userId محدود (قاعده‌ی ۴: داده‌ی هر کاربر فقط برای همان کاربر).
 * داده‌ی حساسِ دیسک (storagePath/extractedText) به UI برنمی‌گردد؛ فقط متادیتای نمایشی.
 *
 * چرا این‌جا و نه کنارِ route؟ پیش‌تر در `dashboard/resume/data.ts` بود و صفحه‌ی
 * `dashboard/profiles` با `../resume/data` از پوشه‌ی *یک route دیگر* واردش می‌کرد. آن
 * route حالا فقط یک redirect است، پس آن import شکننده بود (حذفِ پوشه = شکستنِ صفحه).
 * ماژول کنارِ کامپوننت‌هایی نشست که مصرف‌کننده‌ی واقعیِ شکلِ داده‌اند و پوشه‌ی `resume/`
 * در مسیرها فقط تغییرِ مسیرِ خودش را نگه می‌دارد.
 */
import { cache } from "react";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { candidateProfiles, resumeFiles } from "@/db/schema";
import type {
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
} from "@/db/schema";

/** پروفایلِ کاملِ کارجو برای فرمِ ویرایش (همه‌ی فیلدهای WF2). */
export interface FullResumeProfile {
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
 * پروفایلِ کاملِ کاربر را برای فرمِ ویرایش می‌خواند (یا null اگر هنوز ساخته نشده).
 * cache شده تا در همان درخواستِ RSC چندبار خوانده نشود.
 */
export const getFullResumeProfile = cache(
  async (userId: string): Promise<FullResumeProfile | null> => {
    const [row] = await db
      .select({
        fullName: candidateProfiles.fullName,
        headline: candidateProfiles.headline,
        summary: candidateProfiles.summary,
        city: candidateProfiles.city,
        phone: candidateProfiles.phone,
        avatarUrl: candidateProfiles.avatarUrl,
        expectedSalary: candidateProfiles.expectedSalary,
        yearsExperience: candidateProfiles.yearsExperience,
        skills: candidateProfiles.skills,
        workExperience: candidateProfiles.workExperience,
        education: candidateProfiles.education,
        languages: candidateProfiles.languages,
        links: candidateProfiles.links,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1);

    if (!row) return null;
    return {
      ...row,
      skills: row.skills ?? [],
      workExperience: row.workExperience ?? [],
      education: row.education ?? [],
      languages: row.languages ?? [],
      links: row.links ?? [],
    };
  },
);

/** خلاصه‌ی یک فایلِ رزومه‌ی آپلودشده برای فهرستِ UI (بدونِ مسیرِ دیسک/متنِ خام). */
export interface ResumeFileItem {
  id: string;
  fileName: string;
  byteSize: number;
  hasText: boolean;
  isParsed: boolean;
  isPrimary: boolean;
  createdAt: Date;
}

/** فهرستِ فایل‌های رزومه‌ی کاربر (تازه‌ترین اول). */
export const getResumeFileList = cache(
  async (userId: string, limit = 20): Promise<ResumeFileItem[]> => {
    const rows = await db
      .select({
        id: resumeFiles.id,
        fileName: resumeFiles.fileName,
        byteSize: resumeFiles.byteSize,
        extractedText: resumeFiles.extractedText,
        parsedFields: resumeFiles.parsedFields,
        isPrimary: resumeFiles.isPrimary,
        createdAt: resumeFiles.createdAt,
      })
      .from(resumeFiles)
      .where(eq(resumeFiles.userId, userId))
      .orderBy(desc(resumeFiles.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      fileName: r.fileName,
      byteSize: r.byteSize,
      hasText: !!r.extractedText && r.extractedText.length > 0,
      isParsed: r.parsedFields !== null && r.parsedFields !== undefined,
      isPrimary: r.isPrimary,
      createdAt: r.createdAt,
    }));
  },
);
