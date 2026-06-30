import "server-only";

/**
 * سرویسِ پایدارسازیِ ایمپورتِ پروفایل (Track C) — منطقِ سمت‌سرورِ اندپوینتِ ایمپورت.
 *
 * مسئولیت: داده‌ی خامِ ایمپورت‌شده‌ی *یک* کاربر را بگیر، نرمال کن، روی پروفایلِ همان
 * کاربر merge کن (بدونِ clobber)، و یک رکوردِ profile_imports ثبت کن. اندپوینت فقط
 * احراز هویت + اعتبارسنجیِ بدنه را انجام می‌دهد و این تابع را با userIdِ نشست صدا می‌زند.
 *
 * قواعدِ §10 که اینجا تضمین می‌شود:
 *   • userId همیشه از *نشست* می‌آید (پارامترِ تابع)، نه از payload — داده‌ی هر کاربر
 *     فقط برای همان کاربر. `normalizeImportedProfile` هم هیچ userIdای از payload نمی‌خواند.
 *   • `normalizeImportedProfile` پیش از هر کاری `assertNoCredentials` را اجرا می‌کند
 *     (دفاع در عمق؛ علاوه بر اعتبارسنجیِ zod در اندپوینت).
 */
import { and, eq } from "drizzle-orm";

import { db, type Database } from "@/db";
import { candidateProfiles, profileImports } from "@/db/schema";
import type { JobBoardId } from "@/lib/apply/types";
import {
  normalizeImportedProfile,
  type RawImportPayload,
  type ImportedApplication,
} from "@/lib/apply/import";
import { mergeProfilePatch, type MergedProfileFields } from "@/lib/apply/import-merge";

/** خلاصه‌ی آنچه یک ایمپورت انجام داد — بدنه‌ی پاسخِ اندپوینت. */
export interface ApplyImportSummary {
  /** شناسه‌ی رکوردِ profile_imports که ثبت شد. */
  importId: string;
  board: JobBoardId;
  status: "applied" | "received" | "failed";
  /** نامِ فیلدهایی که روی پروفایلِ کاربر اعمال شد. */
  appliedFields: string[];
  /** مهارت‌هایی که تازه افزوده شدند. */
  addedSkills: string[];
  /** تعدادِ سوابقِ اپلایِ ایمپورت‌شده (فعلاً فقط در rawPayload نگه‌داری می‌شود). */
  importedApplicationCount: number;
}

/** تزریقِ db برای تست (پیش‌فرض: کلاینتِ واقعی). */
export interface ApplyImportDeps {
  database?: Database;
}

/**
 * داده‌ی ایمپورت‌شده را برای کاربرِ احرازشده اعمال می‌کند.
 *
 * گام‌ها:
 *   ۱) نرمال‌سازی (با نگهبانِ اعتبارنامه‌ی §10).
 *   ۲) خواندنِ پروفایلِ فعلیِ همین کاربر.
 *   ۳) merge وصله روی پروفایل (skills → union؛ بقیه → پر کردنِ خالی‌ها).
 *   ۴) اگر چیزی تغییر کرد → update/insert پروفایل.
 *   ۵) ثبتِ رکوردِ profile_imports با rawPayload + appliedFields.
 *
 * @param userId    از نشست (نه از payload) — قاعده‌ی §10.
 * @param board     سایتِ مبدأ.
 * @param rawPayload داده‌ی خامِ ایمپورت (فقط داده؛ هرگز اعتبارنامه).
 */
export async function applyProfileImport(
  userId: string,
  board: JobBoardId,
  rawPayload: RawImportPayload,
  deps: ApplyImportDeps = {},
): Promise<ApplyImportSummary> {
  const database = deps.database ?? db;

  // ۱) نرمال‌سازی — `assertNoCredentials` داخلِ این تابع پیش از هر چیز اجرا می‌شود.
  const normalized = normalizeImportedProfile(board, rawPayload);
  const applications: ImportedApplication[] = normalized.applications ?? [];

  // ۲) پروفایلِ فعلیِ همین کاربر (قاعده‌ی §10 — مقید به userIdِ نشست).
  const [existing] = await database
    .select({
      id: candidateProfiles.id,
      fullName: candidateProfiles.fullName,
      headline: candidateProfiles.headline,
      skills: candidateProfiles.skills,
      yearsExperience: candidateProfiles.yearsExperience,
      city: candidateProfiles.city,
      resumeText: candidateProfiles.resumeText,
    })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);

  // ۳) merge خالص.
  const merge = mergeProfilePatch(existing, normalized.profilePatch);

  // ۴) اعمال روی DB فقط در صورتِ وجودِ تغییر.
  if (merge.appliedFieldNames.length > 0) {
    await persistProfileChanges(database, userId, existing?.id, merge.changed);
  }

  // ۵) ثبتِ رکوردِ ایمپورت (همیشه — حتی اگر چیزی merge نشد، برای تاریخچه/شفافیت).
  const importStatus: "applied" | "received" =
    merge.appliedFieldNames.length > 0 ? "applied" : "received";

  const [importRow] = await database
    .insert(profileImports)
    .values({
      userId,
      board,
      status: importStatus,
      rawPayload,
      appliedFields: {
        fields: merge.appliedFieldNames,
        addedSkills: merge.addedSkills,
        importedApplicationCount: applications.length,
      },
    })
    .returning({ id: profileImports.id });

  return {
    importId: importRow.id,
    board,
    status: importStatus,
    appliedFields: merge.appliedFieldNames,
    addedSkills: merge.addedSkills,
    importedApplicationCount: applications.length,
  };
}

/**
 * تغییراتِ پروفایل را می‌نویسد: اگر کاربر پروفایل دارد → update؛ وگرنه insertِ یک
 * پروفایلِ تازه. fullName ستونِ NOT NULL است؛ هنگامِ insert اگر ایمپورت نام نداده،
 * یک placeholder خنثی می‌گذاریم تا کاربر بعداً در داشبورد ویرایش کند.
 */
async function persistProfileChanges(
  database: Database,
  userId: string,
  existingProfileId: string | undefined,
  changed: MergedProfileFields,
): Promise<void> {
  const now = new Date();

  if (existingProfileId) {
    await database
      .update(candidateProfiles)
      .set({ ...changed, updatedAt: now })
      .where(
        and(
          eq(candidateProfiles.id, existingProfileId),
          eq(candidateProfiles.userId, userId),
        ),
      );
    return;
  }

  // پروفایلِ تازه — fullName اجباری است.
  await database.insert(candidateProfiles).values({
    userId,
    fullName: changed.fullName ?? "کاربرِ کارجو",
    headline: changed.headline ?? null,
    skills: changed.skills ?? [],
    yearsExperience: changed.yearsExperience ?? null,
    city: changed.city ?? null,
    resumeText: changed.resumeText ?? null,
    updatedAt: now,
  });
}
