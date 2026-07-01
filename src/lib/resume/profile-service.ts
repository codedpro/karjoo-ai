import "server-only";

/**
 * سرویسِ DB پروفایلِ جامع + مدیریتِ فایل‌های رزومه (Track C, WF2).
 *
 * چرا فایلِ جدا از service.ts؟ service.ts (پارس/merge با AI) Foundation-owned است؛ این
 * لایه‌ی Track C است و منطقِ «ویرایشِ دستیِ کاربر» + «فایلِ اصلی/حذف» را نگه می‌دارد بدونِ
 * دست‌زدن به فایلِ Foundation. همه‌ی توابع `userId` را پارامتر می‌گیرند (به نشست مقید،
 * نه از payload — قاعده‌ی ۴)؛ وابستگیِ DB قابلِ تزریق است تا تستِ بدونِ DB ممکن باشد.
 *
 * قاعده‌ی merge اینجا (برخلافِ AI-merge): چون کاربر *صریحاً* فرمِ کامل را دیده و تأیید
 * کرده، مقادیرِ او *جایگزین* می‌شوند (نه fill-empties). یعنی این «حقیقتِ نهایی»ِ کاربر است.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { candidateProfiles, resumeFiles } from "@/db/schema";
import type {
  CandidateProfileRow,
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
} from "@/db/schema";
import { getSelectedSlugs } from "@/lib/interests/store";
import { mergeInterestPreferences } from "@/lib/interests/to-preferences";

/** هندلِ کمینه‌ی Drizzle که این لایه نیاز دارد (تزریق‌پذیر در تست). */
export type ProfileDb = Pick<typeof defaultDb, "insert" | "select" | "update" | "delete">;

/** وابستگی‌های قابل‌تزریقِ سرویس. */
export interface ProfileServiceDeps {
  db?: ProfileDb;
  now?: () => number;
}

/** نامِ پیش‌فرضِ امنِ پروفایل (هم‌راستا با Foundation) — تا insertِ NOT NULL نشکند. */
export const DEFAULT_PROFILE_NAME = "کاربر کارجو";

/**
 * ورودیِ ویرایشِ دستیِ پروفایلِ جامع — *همه‌ی* فیلدهای بردهای ایرانی.
 * فراخواننده (route) این را از resumeProfileSaveSchema می‌سازد؛ اینجا فقط نرمال/ذخیره.
 */
export interface FullProfileInput {
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
 * پروفایلِ کارجوی کاربر را با مقادیرِ ویرایش‌شده‌ی کاربر upsert می‌کند (مسیرِ «فرمِ کاملِ
 * پروفایل» در UI). مقادیر *جایگزین* می‌شوند چون کاربر صریحاً تأییدشان کرده. به نشست مقید.
 *
 * نرمال‌سازی پیش از ذخیره: مهارت‌ها یکتا/trim، ردیف‌های خالیِ آرایه‌ها حذف، متن‌های خالی → null.
 */
export async function saveFullProfile(
  userId: string,
  input: FullProfileInput,
  deps: ProfileServiceDeps = {},
): Promise<CandidateProfileRow> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;

  const values = {
    fullName: input.fullName.trim() || DEFAULT_PROFILE_NAME,
    headline: nullifyEmpty(input.headline),
    summary: nullifyEmpty(input.summary),
    city: nullifyEmpty(input.city),
    phone: nullifyEmpty(input.phone),
    avatarUrl: nullifyEmpty(input.avatarUrl),
    expectedSalary: nullifyEmpty(input.expectedSalary),
    yearsExperience: input.yearsExperience,
    skills: normalizeSkills(input.skills),
    workExperience: normalizeWorkExperience(input.workExperience),
    education: normalizeEducation(input.education),
    languages: normalizeLanguages(input.languages),
    links: normalizeLinks(input.links),
  };

  const [existing] = await db
    .select({ id: candidateProfiles.id })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(candidateProfiles)
      .set({ ...values, updatedAt: new Date(now()) })
      .where(eq(candidateProfiles.userId, userId))
      .returning();
    return updated;
  }

  // پروفایلِ تازه: preferences را از علاقه‌مندی‌های قبلیِ کاربر back-fill کن (هم‌رفتار Foundation).
  const preferences = await preferencesFromInterests(userId, db);
  const [created] = await db
    .insert(candidateProfiles)
    .values({ userId, ...values, ...(preferences ? { preferences } : {}) })
    .returning();
  return created;
}

/* ──────────────────────────  فایلِ اصلی / حذف  ─────────────────────────── */

/**
 * یک فایلِ آپلودشده را «رزومه‌ی اصلی» می‌کند (PDF-only، بدونِ استخراجِ AI — رایگان).
 *
 * اتمیک، در یک تراکنش: اول همه‌ی فایل‌های همین کاربر را is_primary=false می‌کند، سپس این
 * یکی را true (تا ایندکسِ partial-unique نشکند). مالکیت را با شرطِ (id AND userId) بررسی
 * می‌کند (قاعده‌ی ۴) — کاربری نمی‌تواند فایلِ دیگری را با حدسِ id اصلی کند.
 *
 * @returns true اگر فایل متعلق به کاربر بود و اصلی شد؛ false اگر رکورد یافت نشد.
 */
export async function setPrimaryResumeFile(
  userId: string,
  resumeFileId: string,
  deps: ProfileServiceDeps = {},
): Promise<boolean> {
  const db = deps.db ?? defaultDb;

  // نیاز به تراکنش داریم؛ اگر db تراکنش‌پذیر نبود (تستِ fake) روی همان هندل عمل می‌کنیم.
  const run = async (tx: ProfileDb): Promise<boolean> => {
    // ۱) مالکیت را تأیید کن (فقط رکوردِ همین کاربر).
    const [owned] = await tx
      .select({ id: resumeFiles.id })
      .from(resumeFiles)
      .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)))
      .limit(1);
    if (!owned) return false;

    // ۲) همه‌ی فایل‌های کاربر → غیراصلی.
    await tx
      .update(resumeFiles)
      .set({ isPrimary: false })
      .where(eq(resumeFiles.userId, userId));

    // ۳) این یکی → اصلی (باز هم با شرطِ مالکیت، برای اطمینان).
    await tx
      .update(resumeFiles)
      .set({ isPrimary: true })
      .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)));

    return true;
  };

  const maybeTx = db as ProfileDb & {
    transaction?: (fn: (tx: ProfileDb) => Promise<boolean>) => Promise<boolean>;
  };
  if (typeof maybeTx.transaction === "function") {
    return maybeTx.transaction((tx) => run(tx));
  }
  // مسیرِ بدونِ تراکنش (تستِ fake) — همان منطق روی هندلِ اصلی.
  return run(db);
}

/** خروجیِ حذفِ فایل: آیا حذف شد + مسیرِ دیسک (تا route فایلِ فیزیکی را هم پاک کند). */
export interface DeleteResumeFileResult {
  deleted: boolean;
  storagePath: string | null;
}

/**
 * رکوردِ یک فایلِ رزومه‌ی کاربر را حذف می‌کند (فقط اگر متعلق به همین کاربر باشد — قاعده‌ی ۴).
 * مسیرِ دیسکِ رکورد را برمی‌گرداند تا route فایلِ فیزیکی را هم پاک کند (این لایه به دیسک
 * دست نمی‌زند تا خالص/تست‌پذیر بماند). اگر رکورد یافت نشد → deleted=false.
 */
export async function deleteResumeFile(
  userId: string,
  resumeFileId: string,
  deps: ProfileServiceDeps = {},
): Promise<DeleteResumeFileResult> {
  const db = deps.db ?? defaultDb;

  const [row] = await db
    .delete(resumeFiles)
    .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)))
    .returning({ storagePath: resumeFiles.storagePath });

  if (!row) return { deleted: false, storagePath: null };
  return { deleted: true, storagePath: row.storagePath };
}

/**
 * یک فایلِ رزومه‌ی کاربر را برای دانلود می‌خواند (مسیرِ دیسک + نامِ فایل) — فقط اگر متعلق
 * به همین کاربر باشد (قاعده‌ی ۴). route با این مسیر، فایلِ فیزیکی را stream می‌کند.
 */
export interface OwnedResumeFileMeta {
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

export async function getResumeFileForDownload(
  userId: string,
  resumeFileId: string,
  deps: ProfileServiceDeps = {},
): Promise<OwnedResumeFileMeta | null> {
  const db = deps.db ?? defaultDb;

  const [row] = await db
    .select({
      storagePath: resumeFiles.storagePath,
      fileName: resumeFiles.fileName,
      mimeType: resumeFiles.mimeType,
      byteSize: resumeFiles.byteSize,
    })
    .from(resumeFiles)
    .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)))
    .limit(1);

  return row ?? null;
}

/* ────────────────────────────  نرمال‌سازها (خالص)  ──────────────────────── */

/** متنِ خالی/فاصله‌ای → null (تا ستونِ nullable در DB واقعاً null بماند نه رشته‌ی خالی). */
function nullifyEmpty(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t && t.length > 0 ? t : null;
}

/** مهارت‌ها: trim، حذفِ خالی، یکتا (case-insensitive)، سقفِ ۵۰. */
export function normalizeSkills(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of input) {
    const t = s.trim();
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

/** سابقه‌ی کاری: هر ردیف trim، فیلدهای خالی حذف، ردیفِ کاملاً خالی دور ریخته، سقفِ ۳۰. */
export function normalizeWorkExperience(
  input: ProfileWorkExperience[],
): ProfileWorkExperience[] {
  const out: ProfileWorkExperience[] = [];
  for (const raw of input) {
    if (!raw) continue;
    const row: ProfileWorkExperience = {};
    const company = raw.company?.trim();
    const title = raw.title?.trim();
    const startDate = raw.startDate?.trim();
    const endDate = raw.endDate?.trim();
    const description = raw.description?.trim();
    if (company) row.company = company;
    if (title) row.title = title;
    if (startDate) row.startDate = startDate;
    if (!raw.current && endDate) row.endDate = endDate;
    if (raw.current) row.current = true;
    if (description) row.description = description;
    if (Object.keys(row).length === 0) continue;
    out.push(row);
    if (out.length >= 30) break;
  }
  return out;
}

/** تحصیلات: هر ردیف trim، فیلدهای خالی حذف، ردیفِ کاملاً خالی دور ریخته، سقفِ ۲۰. */
export function normalizeEducation(input: ProfileEducation[]): ProfileEducation[] {
  const out: ProfileEducation[] = [];
  for (const raw of input) {
    if (!raw) continue;
    const row: ProfileEducation = {};
    const institution = raw.institution?.trim();
    const degree = raw.degree?.trim();
    const field = raw.field?.trim();
    const startYear = raw.startYear?.trim();
    const endYear = raw.endYear?.trim();
    if (institution) row.institution = institution;
    if (degree) row.degree = degree;
    if (field) row.field = field;
    if (startYear) row.startYear = startYear;
    if (endYear) row.endYear = endYear;
    if (Object.keys(row).length === 0) continue;
    out.push(row);
    if (out.length >= 20) break;
  }
  return out;
}

/** زبان‌ها: name اجباری (ردیفِ بی‌نام حذف)، یکتا بر نام، سقفِ ۲۰. */
export function normalizeLanguages(input: ProfileLanguage[]): ProfileLanguage[] {
  const seen = new Set<string>();
  const out: ProfileLanguage[] = [];
  for (const raw of input) {
    const name = raw?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const level = raw.level?.trim();
    out.push({ name, ...(level ? { level } : {}) });
    if (out.length >= 20) break;
  }
  return out;
}

/** لینک‌ها: url اجباری (ردیفِ بی‌url حذف)، یکتا بر url نرمال‌شده، سقفِ ۱۵. */
export function normalizeLinks(input: ProfileLink[]): ProfileLink[] {
  const seen = new Set<string>();
  const out: ProfileLink[] = [];
  for (const raw of input) {
    const url = raw?.url?.trim();
    if (!url) continue;
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const label = raw.label?.trim();
    out.push({ url, ...(label ? { label } : {}) });
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * preferencesِ مشتق از علاقه‌مندی‌های فعلیِ کاربر — برای back-fill هنگامِ *ساختِ* پروفایل
 * (هم‌رفتار با Foundation#service). best-effort؛ در خطا undefined.
 */
async function preferencesFromInterests(
  userId: string,
  db: ProfileDb,
): Promise<Record<string, unknown> | undefined> {
  try {
    const slugs = await getSelectedSlugs(userId, db as unknown as typeof defaultDb);
    if (slugs.length === 0) return undefined;
    return mergeInterestPreferences(null, slugs);
  } catch {
    return undefined;
  }
}
