import "server-only";

/**
 * خواندنِ داده‌ی صفحه‌ی رزومه‌ی داشبورد مستقیم از DB (server-side، الگوی RSC).
 *
 * فقط-خواندنی و به userId محدود (قاعده‌ی ۴: داده‌ی هر کاربر فقط برای همان کاربر). در
 * data. ts مشترک دست نمی‌زنیم؛ این getterهای مخصوصِ Track A در فایلِ خودِ track می‌مانند.
 * هیچ ستونِ حساسی خوانده نمی‌شود (storagePath/extractedText برای UI لازم نیست).
 */
import { cache } from "react";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { candidateProfiles, resumeFiles } from "@/db/schema";

/** پروفایلِ کاملِ کارجو برای فرمِ ویرایش. */
export interface ResumeProfile {
  fullName: string;
  headline: string | null;
  city: string | null;
  yearsExperience: number | null;
  skills: string[];
}

/** پروفایلِ کاربر را برای فرمِ ویرایشِ رزومه می‌خواند (یا null اگر هنوز ساخته نشده). */
export const getResumeProfile = cache(
  async (userId: string): Promise<ResumeProfile | null> => {
    const [row] = await db
      .select({
        fullName: candidateProfiles.fullName,
        headline: candidateProfiles.headline,
        city: candidateProfiles.city,
        yearsExperience: candidateProfiles.yearsExperience,
        skills: candidateProfiles.skills,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1);

    return row ?? null;
  },
);

/** خلاصه‌ی یک فایلِ رزومه‌ی آپلودشده برای فهرستِ UI (بدونِ مسیرِ دیسک/متنِ خام). */
export interface ResumeFileSummary {
  id: string;
  fileName: string;
  byteSize: number;
  hasText: boolean;
  isParsed: boolean;
  createdAt: Date;
}

/** فهرستِ فایل‌های رزومه‌ی کاربر (تازه‌ترین اول). */
export const getResumeFiles = cache(
  async (userId: string, limit = 10): Promise<ResumeFileSummary[]> => {
    const rows = await db
      .select({
        id: resumeFiles.id,
        fileName: resumeFiles.fileName,
        byteSize: resumeFiles.byteSize,
        extractedText: resumeFiles.extractedText,
        parsedFields: resumeFiles.parsedFields,
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
      createdAt: r.createdAt,
    }));
  },
);
