import "server-only";

/**
 * سرویسِ DB رزومه (Track A, WF1) — منطقِ پایداریِ بینِ route handlerها و DB.
 *
 * هدف: route handlerها نازک بمانند. این لایه:
 *   • رکوردِ resume_files را پس از آپلود می‌سازد (createResumeFileRecord).
 *   • یک رکوردِ رزومه را با مالکیتِ کاربر می‌خواند (getResumeFileOwned) — قاعده‌ی ۴:
 *     فقط رکوردِ خودِ همان کاربر؛ هرگز userId از کلاینت خوانده نمی‌شود.
 *   • فیلدهای ساخت‌یافته را روی رکورد ذخیره و پروفایلِ کارجو را upsert می‌کند
 *     (persistParsedFields) — merge محتاطانه تا داده‌ی موجودِ کاربر بی‌خود پاک نشود.
 *
 * همه‌ی توابع `userId` را پارامتر می‌گیرند (نه از payload)؛ route آن را به نشست مقید
 * می‌کند. وابستگیِ DB قابلِ تزریق است (پیش‌فرض: کلاینتِ واقعی) تا تستِ بدونِ DB ممکن باشد.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { candidateProfiles, resumeFiles } from "@/db/schema";
import type {
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
  ResumeFile,
} from "@/db/schema";
import { getSelectedSlugs } from "@/lib/interests/store";
import { mergeInterestPreferences } from "@/lib/interests/to-preferences";
import type { ParsedResume } from "@/lib/resume/schema";

/** هندلِ کمینه‌ی Drizzle که این لایه نیاز دارد. در تست یک fake سبک تزریق می‌شود. */
export type ResumeDb = Pick<typeof defaultDb, "insert" | "select" | "update">;

/** وابستگی‌های قابل‌تزریقِ سرویس (تست بدونِ DB). */
export interface ResumeServiceDeps {
  db?: ResumeDb;
  /** ساعت برای updatedAt (پیش‌فرض Date.now). */
  now?: () => number;
}

/** ورودیِ ساختِ رکوردِ فایلِ رزومه (پس از ذخیره روی دیسک + استخراجِ متن). */
export interface CreateResumeFileInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  /** مسیرِ نسبیِ ذخیره (از storage.saveResumeFile). */
  storagePath: string;
  /** متنِ خامِ استخراج‌شده (ممکن است خالی باشد اگر PDF متنی نداشت). */
  extractedText: string | null;
}

/**
 * یک رکوردِ resume_files می‌سازد. userId به نشست مقید است (نه از کلاینت). source
 * پیش‌فرضِ schema («upload») می‌ماند چون این مسیرِ آپلودِ مستقیمِ کاربر است.
 */
export async function createResumeFileRecord(
  userId: string,
  input: CreateResumeFileInput,
  deps: ResumeServiceDeps = {},
): Promise<ResumeFile> {
  const db = deps.db ?? defaultDb;

  const [row] = await db
    .insert(resumeFiles)
    .values({
      userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      storagePath: input.storagePath,
      extractedText: input.extractedText,
    })
    .returning();

  return row;
}

/**
 * یک رکوردِ resume_files را *فقط اگر متعلق به همین کاربر باشد* می‌خواند (قاعده‌ی ۴).
 * با شرطِ ترکیبیِ (id AND userId) تضمین می‌کند کاربری نتواند با حدسِ id فایلِ دیگری
 * را بخواند/پردازش کند. در نبودِ رکوردِ متعلق به کاربر، null.
 */
export async function getResumeFileOwned(
  userId: string,
  resumeFileId: string,
  deps: ResumeServiceDeps = {},
): Promise<ResumeFile | null> {
  const db = deps.db ?? defaultDb;

  const [row] = await db
    .select()
    .from(resumeFiles)
    .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)))
    .limit(1);

  return row ?? null;
}

/** خروجیِ ذخیره‌سازیِ فیلدهای پردازش‌شده: رکوردِ به‌روزِ فایل + پروفایلِ به‌روزِ کاربر. */
export interface PersistParsedResult {
  resumeFile: ResumeFile;
  profile: typeof candidateProfiles.$inferSelect;
}

/**
 * فیلدهای ساخت‌یافته‌ی AI را ذخیره می‌کند:
 *   ۱) `parsedFields` را روی رکوردِ resume_files می‌نشاند (با شرطِ مالکیت).
 *   ۲) پروفایلِ کارجوی کاربر را upsert می‌کند (می‌سازد یا merge می‌کند).
 *
 * merge محتاطانه است: فقط فیلدهایی که AI واقعاً استخراج کرده پروفایل را به‌روز می‌کنند؛
 * مهارت‌ها با مهارت‌های موجود ادغام (یکتا) می‌شوند تا داده‌ی قبلیِ کاربر پاک نشود.
 * فراخواننده می‌تواند با `overrides` مقادیرِ ویرایش‌شده‌ی کاربر را اولویت دهد.
 */
export async function persistParsedFields(
  userId: string,
  resumeFileId: string,
  parsed: ParsedResume,
  deps: ResumeServiceDeps = {},
): Promise<PersistParsedResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;

  // ۱) ذخیره‌ی parsedFields روی رکورد — فقط اگر متعلق به همین کاربر باشد (قاعده‌ی ۴).
  const [resumeFile] = await db
    .update(resumeFiles)
    .set({ parsedFields: parsed as Record<string, unknown> })
    .where(and(eq(resumeFiles.id, resumeFileId), eq(resumeFiles.userId, userId)))
    .returning();

  if (!resumeFile) {
    throw new Error("رکوردِ رزومه یافت نشد یا متعلق به این کاربر نیست.");
  }

  // ۲) پروفایلِ موجودِ کاربر (در صورتِ وجود).
  const [existing] = await db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);

  const merged = mergeProfileFields(existing ?? null, parsed);

  let profile: typeof candidateProfiles.$inferSelect;
  if (existing) {
    const [updated] = await db
      .update(candidateProfiles)
      .set({ ...merged, updatedAt: new Date(now()) })
      .where(eq(candidateProfiles.userId, userId))
      .returning();
    profile = updated;
  } else {
    // پروفایلِ تازه: preferences را از علاقه‌مندی‌های قبلیِ کاربر back-fill کن.
    const preferences = await preferencesFromInterests(userId, db);
    const [created] = await db
      .insert(candidateProfiles)
      .values({ userId, ...merged, ...(preferences ? { preferences } : {}) })
      .returning();
    profile = created;
  }

  return { resumeFile, profile };
}

/** نامِ پیش‌فرضِ امنِ پروفایل — وقتی نه کاربر نه AI نامی نداد (تا insertِ NOT NULL نشکند). */
export const DEFAULT_PROFILE_NAME = "کاربر کارجو";

/** فیلدهای قابلِ‌نوشتنِ پروفایل که از parsed استخراج می‌شوند. */
export interface ProfileFieldUpdate {
  fullName: string;
  headline: string | null;
  summary: string | null;
  city: string | null;
  phone: string | null;
  expectedSalary: string | null;
  yearsExperience: number | null;
  skills: string[];
  workExperience: ProfileWorkExperience[];
  education: ProfileEducation[];
  languages: ProfileLanguage[];
  links: ProfileLink[];
  resumeText?: string;
}

/**
 * فیلدهای parsed را روی پروفایلِ موجود merge می‌کند (تابعِ خالص، قابلِ تست).
 *
 * قواعد merge (WF2 — «پر کردنِ خالی‌ها»، بدونِ پاک‌کردنِ ویرایشِ کاربر):
 *   • fullName اجباری است (NOT NULL در schema) و fill-empties: نامِ *واقعیِ* موجودِ
 *     کاربر حفظ می‌شود؛ اما اگر نامِ قبلی نبود یا صرفاً placeholderِ پیش‌فرض بود، نامِ AI
 *     جایگزینش می‌شود. اگر هیچ‌کدام نبود، همان placeholderِ امن می‌ماند تا insert نشکند.
 *   • اسکالرها (headline/summary/city/phone/expectedSalary/yearsExperience): فقط وقتی AI
 *     مقدار داد *و* پروفایلِ قبلی آن فیلد را خالی داشت، مقدارِ AI می‌نشیند؛ وگرنه مقدارِ
 *     قبلیِ کاربر حفظ می‌شود (fill-empties — ویرایشِ کاربر هرگز کوبیده نمی‌شود).
 *   • آرایه‌ها (skills/workExperience/education/languages/links): مقادیرِ AI به مقادیرِ
 *     موجود *افزوده* و dedupe می‌شوند (append+dedupe؛ داده‌ی قبلی پاک نمی‌شود).
 */
export function mergeProfileFields(
  existing: (typeof candidateProfiles.$inferSelect) | null,
  parsed: ParsedResume,
): ProfileFieldUpdate {
  // نامِ موجودِ کاربر را حفظ کن، مگر خالی/placeholder باشد که آنگاه نامِ AI جایش می‌نشیند.
  const existingName = existing?.fullName?.trim();
  const realExistingName =
    existingName && existingName !== DEFAULT_PROFILE_NAME ? existingName : undefined;
  const fullName =
    realExistingName || parsed.fullName?.trim() || DEFAULT_PROFILE_NAME;

  // اسکالرها: fill-empties — مقدارِ قبلیِ کاربر بر مقدارِ AI اولویت دارد.
  const headline = fillEmpty(existing?.headline, parsed.headline);
  const summary = fillEmpty(existing?.summary, parsed.summary);
  const city = fillEmpty(existing?.city, parsed.city);
  const phone = fillEmpty(existing?.phone, parsed.phone);
  const expectedSalary = fillEmpty(existing?.expectedSalary, parsed.expectedSalary);
  const yearsExperience =
    typeof existing?.yearsExperience === "number"
      ? existing.yearsExperience
      : typeof parsed.yearsExperience === "number"
        ? parsed.yearsExperience
        : null;

  // آرایه‌ها: append + dedupe (داده‌ی قبلی حفظ، تکراری‌ها حذف).
  const skills = mergeSkills(existing?.skills ?? [], parsed.skills);
  const workExperience = mergeWorkExperience(
    existing?.workExperience ?? [],
    parsed.experience,
  );
  const education = mergeEducation(existing?.education ?? [], parsed.education);
  const languages = mergeLanguages(existing?.languages ?? [], parsed.languages);
  const links = mergeLinks(existing?.links ?? [], parsed.links);

  return {
    fullName,
    headline,
    summary,
    city,
    phone,
    expectedSalary,
    yearsExperience,
    skills,
    workExperience,
    education,
    languages,
    links,
  };
}

/**
 * fill-empties برای یک فیلدِ اسکالرِ متنی: مقدارِ *موجودِ* کاربر را حفظ می‌کند؛ فقط اگر
 * خالی/غایب بود، مقدارِ تازه (AI) را می‌گذارد. خروجی همیشه string|null (نه undefined/خالی).
 */
function fillEmpty(
  existing: string | null | undefined,
  incoming: string | undefined,
): string | null {
  const cur = existing?.trim();
  if (cur) return cur;
  const next = incoming?.trim();
  return next && next.length > 0 ? next : null;
}

/** فیلدهای ویرایش‌شده‌ی کاربر برای ذخیره‌ی مستقیمِ پروفایل (بدونِ AI). */
export interface ManualProfileInput {
  fullName: string;
  headline: string | null;
  city: string | null;
  yearsExperience: number | null;
  skills: string[];
}

/**
 * پروفایلِ کارجوی کاربر را با مقادیرِ ویرایش‌شده‌ی کاربر upsert می‌کند (مسیرِ «ویرایش و
 * ذخیره» در UI). برخلافِ persistParsedFields، اینجا مقادیرِ کاربر *جایگزین* می‌شوند
 * (نه merge)، چون کاربر صریحاً همان‌ها را تأیید کرده. به نشست مقید (userId پارامتر، نه payload).
 */
export async function saveProfileFields(
  userId: string,
  input: ManualProfileInput,
  deps: ResumeServiceDeps = {},
): Promise<typeof candidateProfiles.$inferSelect> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? Date.now;

  const values = {
    fullName: input.fullName,
    headline: input.headline,
    city: input.city,
    yearsExperience: input.yearsExperience,
    skills: mergeSkills([], input.skills),
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

  const preferences = await preferencesFromInterests(userId, db);
  const [created] = await db
    .insert(candidateProfiles)
    .values({ userId, ...values, ...(preferences ? { preferences } : {}) })
    .returning();
  return created;
}

/**
 * preferencesِ مشتق از علاقه‌مندی‌های فعلیِ کاربر — برای back-fill هنگامِ *ساختِ* پروفایل.
 *
 * چرا؟ اگر کاربر اول علاقه‌مندی‌ها را انتخاب کند و *بعد* پروفایل ساخته شود (آپلودِ رزومه/
 * ذخیره‌ی دستی)، بدونِ این back-fill، preferences.titles خالی می‌ماند و دسته‌های انتخابیِ
 * کاربر هرگز به جست‌وجو/تطبیق نمی‌رسند (رفعِ یافته‌ی ممیزی WF1). مسیرِ به‌روزرسانیِ پروفایل
 * نیازی ندارد چون replaceInterests وقتی پروفایل هست preferences را همگام نگه می‌دارد.
 *
 * best-effort: اگر خواندنِ علاقه‌مندی‌ها ممکن نشد، پروفایل بدونِ preferences ساخته می‌شود
 * (کاربر می‌تواند با ذخیره‌ی دوباره‌ی صفحه‌ی علاقه‌مندی همگام کند).
 */
async function preferencesFromInterests(
  userId: string,
  db: ResumeDb,
): Promise<Record<string, unknown> | undefined> {
  try {
    const slugs = await getSelectedSlugs(userId, db as unknown as typeof defaultDb);
    if (slugs.length === 0) return undefined;
    return mergeInterestPreferences(null, slugs);
  } catch {
    return undefined;
  }
}

/** ادغامِ یکتا و trim-شده‌ی دو فهرستِ مهارت (موجود اول, تازه‌ها بعد). سقف ۵۰. */
export function mergeSkills(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...existing, ...incoming]) {
    const trimmed = s.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= 50) break;
  }
  return out;
}

/* ─────────────────  ادغامِ آرایه‌های ساخت‌یافته‌ی پروفایل (WF2)  ─────────────── */
/*
 * قاعده‌ی مشترک: append + dedupe. مقادیرِ موجودِ کاربر اول می‌آیند و حفظ می‌شوند؛ ردیفِ
 * تازه فقط اگر «کلیدِ هویتش» تکراری نباشد افزوده می‌شود. کلیدِ هویت برای هر نوع، امضایِ
 * نرمال‌شده‌ی فیلدهای شناسه‌ایِ آن است (نه کلِ شیء) تا نویزِ جزئی ردیفِ تکراری نسازد.
 */

/** آیا مقدار یک آرایه‌ی معتبر است؟ (DB با default []؛ ولی داده‌ی legacy ممکن است null باشد). */
function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

/** ادغامِ سابقه‌ی کاری — کلیدِ هویت: company|title|startDate (نرمال‌شده). سقف ۳۰. */
export function mergeWorkExperience(
  existing: ProfileWorkExperience[] | null | undefined,
  incoming: ProfileWorkExperience[] | null | undefined,
): ProfileWorkExperience[] {
  const seen = new Set<string>();
  const out: ProfileWorkExperience[] = [];
  for (const e of [...asArray(existing), ...asArray(incoming)]) {
    if (!e || (!e.company && !e.title && !e.startDate && !e.endDate && !e.description)) {
      continue;
    }
    const key = sig(e.company, e.title, e.startDate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= 30) break;
  }
  return out;
}

/** ادغامِ تحصیلات — کلیدِ هویت: institution|degree|field. سقف ۲۰. */
export function mergeEducation(
  existing: ProfileEducation[] | null | undefined,
  incoming: ProfileEducation[] | null | undefined,
): ProfileEducation[] {
  const seen = new Set<string>();
  const out: ProfileEducation[] = [];
  for (const e of [...asArray(existing), ...asArray(incoming)]) {
    if (!e || (!e.institution && !e.degree && !e.field && !e.startYear && !e.endYear)) {
      continue;
    }
    const key = sig(e.institution, e.degree, e.field);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= 20) break;
  }
  return out;
}

/** ادغامِ زبان‌ها — کلیدِ هویت: نامِ زبان (نرمال‌شده). سقف ۲۰. */
export function mergeLanguages(
  existing: ProfileLanguage[] | null | undefined,
  incoming: ProfileLanguage[] | null | undefined,
): ProfileLanguage[] {
  const seen = new Set<string>();
  const out: ProfileLanguage[] = [];
  for (const l of [...asArray(existing), ...asArray(incoming)]) {
    const name = l?.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, ...(l.level?.trim() ? { level: l.level.trim() } : {}) });
    if (out.length >= 20) break;
  }
  return out;
}

/** ادغامِ لینک‌ها — کلیدِ هویت: url (نرمال‌شده). سقف ۱۵. */
export function mergeLinks(
  existing: ProfileLink[] | null | undefined,
  incoming: ProfileLink[] | null | undefined,
): ProfileLink[] {
  const seen = new Set<string>();
  const out: ProfileLink[] = [];
  for (const l of [...asArray(existing), ...asArray(incoming)]) {
    const url = l?.url?.trim();
    if (!url) continue;
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, ...(l.label?.trim() ? { label: l.label.trim() } : {}) });
    if (out.length >= 15) break;
  }
  return out;
}

/** امضای نرمال‌شده‌ی چند فیلدِ شناسه‌ای — برای dedupeِ ردیف‌های آرایه (case/space-insensitive). */
function sig(...parts: Array<string | undefined | null>): string {
  return parts.map((p) => (p ?? "").trim().toLowerCase()).join("|");
}
