import "server-only";

/**
 * هِلپرِ «فیلترهای اپلای» — منبعِ حقیقتِ خواندن/نوشتنِ انتخاب‌های فیلترِ کاربر (Foundation).
 *
 * پیوُت محصول: انتخابِ اصلیِ کاربر «دسته/فیلترِ خودِ سایت» است (نه AI). این انتخاب‌ها در
 * jsonbِ موجودِ candidate_profiles.preferences ذخیره می‌شوند — بدونِ ستون/مهاجرتِ جدید.
 * کلیدهای مالِ این لایه:
 *   • categorySlugs — machine_nameِ دسته‌های جابینجا (filters[job_categories][]).
 *   • cities        — شهرها (filters[locations][]).
 *   • jobTypes      — نوعِ همکاری (filters[job_types][]).
 *   • remoteOnly    — فقط دورکاری (filters[remote]=1).
 *   • minSalary     — حداقلِ حقوق (filters[sal_min]).
 *   • sort          — ترتیبِ نتایج (relevance/newest/highest-pay).
 *   • aiFilterEnabled — تاگلِ «فیلترِ هوشمند (AI)» (پریمیوم، Phase 4).
 *
 * عمداً کلیدهای `titles`/`categories`ِ مشتق از «علاقه‌مندی‌ها» (interests) را دست نمی‌زند
 * تا آن مسیر نشکند؛ هر دو در همان jsonb کنارِ هم می‌مانند و هر دو به buildSearchUrl تغذیه
 * می‌شوند. توابعِ نگاشت خالص‌اند (بدونِ DB) تا در route/UI/تست هم استفاده شوند.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { candidateProfiles } from "@/db/schema";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";
import type { JobPreferences } from "@/lib/apply/types";

/** هندلِ کمینه‌ی DB که این لایه لازم دارد — همان کلاینتِ Drizzle. */
export type FiltersDb = typeof defaultDb;

/**
 * زیرمجموعه‌ی «فیلترهای اپلای» که این لایه مالکِ نوشتنش است.
 *
 * توجه: `titles` (کلیدواژه‌ی جست‌وجو) عمداً اینجا نیست — آن از «علاقه‌مندی‌ها» مشتق و
 * توسطِ interests store مدیریت می‌شود؛ نگهش می‌داریم تا clobber نشود.
 */
export interface ApplyFilters {
  /** machine_nameِ دسته‌های جابینجا. */
  categorySlugs: string[];
  /** شهرها. */
  cities: string[];
  /** نوعِ همکاری (اسلاگِ jobinja filters[job_types][]). */
  jobTypes: string[];
  /** فقط دورکاری. */
  remoteOnly: boolean;
  /** حداقلِ حقوق (تومان). undefined = بدونِ حداقل. */
  minSalary?: number;
  /** ترتیبِ نتایج: relevance_desc | published_at_desc | salary_from_desc. */
  sort?: string;
  /** تاگلِ فیلترِ هوشمند (AI) — پریمیوم. */
  aiFilterEnabled: boolean;
  /** توقفِ کشف/صف‌گذاریِ خودکار تا وقتی کاربر دوباره فعال کند. */
  paused: boolean;
  /** سقفِ صف‌گذاری در روز. undefined = سقف پلن/پیش‌فرض. */
  dailyLimit?: number;
  /** سقفِ صف‌گذاری در هفته. undefined = بدون سقف هفتگیِ کاربر. */
  weeklyLimit?: number;
  /** Maximum posting age accepted by discovery, capped by provider sync policy. */
  maxAgeDays: number;
  /** Versioned per-board targeting; legacy Jobinja fields above remain mirrored. */
  boardFiltersVersion: 1;
  boardFilters: BoardApplyFilters;
}

export interface BoardFilter {
  enabled: boolean;
  categoryKeys: string[];
  cities: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  minSalary?: number;
  sort?: string;
}

export interface BoardApplyFilters {
  jobinja: BoardFilter;
  jobvision: BoardFilter;
  "e-estekhdam": BoardFilter;
  irantalent: BoardFilter;
  karboom: BoardFilter;
}

export type ActiveApplyBoard = keyof BoardApplyFilters;

/** Active provider ids used by discovery, resume preparation, and queue claims. */
export function enabledApplyBoards(filters: ApplyFilters): ActiveApplyBoard[] {
  return (Object.keys(filters.boardFilters) as ActiveApplyBoard[]).filter(
    (board) => filters.boardFilters[board].enabled,
  );
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function boardTargetSignature(filter: BoardFilter): string {
  return JSON.stringify({
    enabled: filter.enabled,
    categoryKeys: sorted(filter.categoryKeys),
    cities: sorted(filter.cities),
    employmentTypeKeys: sorted(filter.employmentTypeKeys),
    remoteOnly: filter.remoteOnly,
    minSalary: filter.minSalary ?? null,
    sort: filter.sort ?? null,
  });
}

/** Boards whose saved targeting changed enough to make their pending queue stale. */
export function changedApplyFilterBoards(
  current: ApplyFilters,
  next: ApplyFilters,
): ActiveApplyBoard[] {
  const boards = Object.keys(next.boardFilters) as ActiveApplyBoard[];
  if (current.maxAgeDays !== next.maxAgeDays) return boards;
  return boards.filter(
    (board) =>
      boardTargetSignature(current.boardFilters[board]) !==
      boardTargetSignature(next.boardFilters[board]),
  );
}

function emptyBoardFilter(enabled = false): BoardFilter {
  return { enabled, categoryKeys: [], cities: [], employmentTypeKeys: [], remoteOnly: false };
}

/** فیلترِ خالی (پیش‌فرضِ کاربرِ بدونِ انتخاب). */
export const EMPTY_APPLY_FILTERS: ApplyFilters = {
  categorySlugs: [],
  cities: [],
  jobTypes: [],
  remoteOnly: false,
  aiFilterEnabled: false,
  paused: false,
  maxAgeDays: MAX_PROVIDER_SYNC_AGE_DAYS,
  boardFiltersVersion: 1,
  boardFilters: {
    jobinja: emptyBoardFilter(true),
    jobvision: emptyBoardFilter(false),
    "e-estekhdam": emptyBoardFilter(false),
    irantalent: emptyBoardFilter(false),
    karboom: emptyBoardFilter(false),
  },
};

/** آرایه‌ی رشته‌ی تمیز و یکتا (trim‌شده، بدونِ خالی، بدونِ تکرار). */
function cleanStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** عددِ مثبت یا undefined (حقوقِ حداقلِ نامعتبر/صفر → undefined). */
function positiveNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** رشته‌ی غیرخالیِ trim‌شده یا undefined. */
function nonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseBoardFilter(raw: unknown, fallback: BoardFilter): BoardFilter {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const minSalary = positiveNumber(value.minSalary);
  const sort = nonEmptyString(value.sort);
  const hasValue = Object.keys(value).length > 0;
  if (!hasValue) return { ...fallback };
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    categoryKeys: cleanStringArray(value.categoryKeys),
    cities: cleanStringArray(value.cities),
    employmentTypeKeys: cleanStringArray(value.employmentTypeKeys),
    remoteOnly: value.remoteOnly === true,
    ...(minSalary === undefined ? {} : { minSalary }),
    ...(sort === undefined ? {} : { sort }),
  };
}

/**
 * jsonbِ ذخیره‌شده (preferences) → ApplyFilters نوع‌دار. مقاوم در برابرِ داده‌ی کهنه/بدشکل
 * (کلیدهای نامعتبر بی‌سروصدا کنار می‌روند). تابعِ خالص.
 */
export function parseApplyFilters(
  raw: Record<string, unknown> | null | undefined,
): ApplyFilters {
  if (!raw || typeof raw !== "object") return { ...EMPTY_APPLY_FILTERS };
  const minSalary = positiveNumber(raw.minSalary);
  const sort = nonEmptyString(raw.sort);
  const legacyJobinja: BoardFilter = {
    enabled: true,
    categoryKeys: cleanStringArray(raw.categorySlugs),
    cities: cleanStringArray(raw.cities),
    employmentTypeKeys: cleanStringArray(raw.jobTypes),
    remoteOnly: raw.remoteOnly === true,
    ...(minSalary === undefined ? {} : { minSalary }),
    ...(sort === undefined ? {} : { sort }),
  };
  const rawBoards = raw.boardFilters && typeof raw.boardFilters === "object"
    ? raw.boardFilters as Record<string, unknown>
    : {};
  const jobinja = parseBoardFilter(rawBoards.jobinja, legacyJobinja);
  const jobvision = parseBoardFilter(rawBoards.jobvision, emptyBoardFilter(false));
  const eEstekhdam = parseBoardFilter(rawBoards["e-estekhdam"], emptyBoardFilter(false));
  const irantalent = parseBoardFilter(rawBoards.irantalent, emptyBoardFilter(false));
  const karboom = parseBoardFilter(rawBoards.karboom, emptyBoardFilter(false));
  return {
    categorySlugs: jobinja.categoryKeys,
    cities: jobinja.cities,
    jobTypes: jobinja.employmentTypeKeys,
    remoteOnly: jobinja.remoteOnly,
    ...(jobinja.minSalary === undefined ? {} : { minSalary: jobinja.minSalary }),
    ...(jobinja.sort === undefined ? {} : { sort: jobinja.sort }),
    aiFilterEnabled: raw.aiFilterEnabled === true,
    paused: raw.paused === true,
    ...(positiveNumber(raw.dailyLimit) === undefined
      ? {}
      : { dailyLimit: Math.floor(positiveNumber(raw.dailyLimit)!) }),
    ...(positiveNumber(raw.weeklyLimit) === undefined
      ? {}
      : { weeklyLimit: Math.floor(positiveNumber(raw.weeklyLimit)!) }),
    maxAgeDays: Math.min(
      MAX_PROVIDER_SYNC_AGE_DAYS,
      Math.max(1, Math.floor(positiveNumber(raw.maxAgeDays) ?? MAX_PROVIDER_SYNC_AGE_DAYS)),
    ),
    boardFiltersVersion: 1,
    boardFilters: { jobinja, jobvision, "e-estekhdam": eEstekhdam, irantalent, karboom },
  };
}

/**
 * jsonbِ ذخیره‌شده (preferences) → JobPreferences کاملِ types.ts برای مصرفِ
 * buildSearchUrl/scrapePublic. برخلافِ ApplyFilters، این تابع `titles` و
 * `employmentTypes` (کلیدهای مشتق/میراث) را هم می‌خواند تا URLِ جست‌وجو کامل بماند.
 * تابعِ خالص.
 */
export function toJobPreferences(
  raw: Record<string, unknown> | null | undefined,
): JobPreferences {
  const f = parseApplyFilters(raw);
  const titles = cleanStringArray(raw?.titles);
  const employmentTypes = Array.isArray(raw?.employmentTypes)
    ? (raw?.employmentTypes as JobPreferences["employmentTypes"])
    : undefined;

  const prefs: JobPreferences = {};
  if (titles.length > 0) prefs.titles = titles;
  if (f.cities.length > 0) prefs.cities = f.cities;
  if (f.categorySlugs.length > 0) prefs.categorySlugs = f.categorySlugs;
  if (f.jobTypes.length > 0) prefs.jobTypes = f.jobTypes;
  if (f.remoteOnly) prefs.remoteOnly = true;
  if (f.paused) prefs.paused = true;
  if (f.dailyLimit !== undefined) prefs.dailyLimit = f.dailyLimit;
  if (f.weeklyLimit !== undefined) prefs.weeklyLimit = f.weeklyLimit;
  if (raw?.unlimitedApply === true) prefs.unlimitedApply = true;
  if (raw?.gender === "male" || raw?.gender === "female" || raw?.gender === "unspecified") {
    prefs.gender = raw.gender;
  }
  if (f.minSalary !== undefined) prefs.minSalary = f.minSalary;
  if (f.sort !== undefined) prefs.sort = f.sort;
  if (employmentTypes && employmentTypes.length > 0) prefs.employmentTypes = employmentTypes;
  return prefs;
}

/**
 * ApplyFilters را روی preferencesِ موجود merge می‌کند و شیِ کاملِ jsonb را برمی‌گرداند
 * (بدونِ از دست‌رفتنِ کلیدهای دیگر مثل titles/categories/employmentTypes). فقط کلیدهای
 * مالِ این لایه بازنویسی می‌شوند. تابعِ خالص.
 */
export function mergeApplyFilters(
  existing: Record<string, unknown> | null | undefined,
  filters: ApplyFilters,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};

  base.categorySlugs = cleanStringArray(filters.categorySlugs);
  base.cities = cleanStringArray(filters.cities);
  base.jobTypes = cleanStringArray(filters.jobTypes);
  base.remoteOnly = filters.remoteOnly === true;
  base.aiFilterEnabled = filters.aiFilterEnabled === true;
  base.paused = filters.paused === true;

  const minSalary = positiveNumber(filters.minSalary);
  if (minSalary === undefined) delete base.minSalary;
  else base.minSalary = minSalary;

  const sort = nonEmptyString(filters.sort);
  if (sort === undefined) delete base.sort;
  else base.sort = sort;

  const dailyLimit = positiveNumber(filters.dailyLimit);
  if (dailyLimit === undefined) delete base.dailyLimit;
  else base.dailyLimit = Math.floor(dailyLimit);

  const weeklyLimit = positiveNumber(filters.weeklyLimit);
  if (weeklyLimit === undefined) delete base.weeklyLimit;
  else base.weeklyLimit = Math.floor(weeklyLimit);

  const jobinja = parseBoardFilter(filters.boardFilters?.jobinja, {
    enabled: true,
    categoryKeys: filters.categorySlugs,
    cities: filters.cities,
    employmentTypeKeys: filters.jobTypes,
    remoteOnly: filters.remoteOnly,
    ...(filters.minSalary === undefined ? {} : { minSalary: filters.minSalary }),
    ...(filters.sort === undefined ? {} : { sort: filters.sort }),
  });
  const jobvision = parseBoardFilter(filters.boardFilters?.jobvision, emptyBoardFilter(false));
  const eEstekhdam = parseBoardFilter(
    filters.boardFilters?.["e-estekhdam"],
    emptyBoardFilter(false),
  );
  const irantalent = parseBoardFilter(
    filters.boardFilters?.irantalent,
    emptyBoardFilter(false),
  );
  const karboom = parseBoardFilter(
    filters.boardFilters?.karboom,
    emptyBoardFilter(false),
  );
  base.boardFiltersVersion = 1;
  base.boardFilters = { jobinja, jobvision, "e-estekhdam": eEstekhdam, irantalent, karboom };
  base.maxAgeDays = Math.min(
    MAX_PROVIDER_SYNC_AGE_DAYS,
    Math.max(1, Math.floor(filters.maxAgeDays || MAX_PROVIDER_SYNC_AGE_DAYS)),
  );

  // Compatibility for the existing dashboard and Jobinja orchestrator.
  base.categorySlugs = jobinja.categoryKeys;
  base.cities = jobinja.cities;
  base.jobTypes = jobinja.employmentTypeKeys;
  base.remoteOnly = jobinja.remoteOnly;

  return base;
}

/* ─────────────────────────────  خواندن/نوشتن (DB)  ──────────────────────── */

/**
 * فیلترهای اپلای کاربر را از پروفایلش می‌خواند. اگر پروفایلی نباشد → فیلترِ خالی.
 * فقط-خواندنی و مقید به همان userId (قاعده‌ی ۴).
 */
export async function readApplyFilters(
  userId: string,
  db: FiltersDb = defaultDb,
): Promise<ApplyFilters> {
  const [row] = await db
    .select({ preferences: candidateProfiles.preferences })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  return parseApplyFilters(row?.preferences ?? null);
}

/** Read the complete targeting preferences, including inherited titles and gender. */
export async function readJobPreferences(
  userId: string,
  db: FiltersDb = defaultDb,
): Promise<JobPreferences> {
  const [row] = await db
    .select({ preferences: candidateProfiles.preferences })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  return toJobPreferences(row?.preferences ?? null);
}

/** خروجیِ نوشتنِ فیلترها. */
export interface WriteApplyFiltersResult {
  filters: ApplyFilters;
  /** آیا پروفایلِ تازه ساخته شد (کاربر قبلاً پروفایل نداشت)؟ */
  createdProfile: boolean;
}

/**
 * فیلترهای اپلای کاربر را در preferencesِ پروفایلش می‌نویسد (merge؛ کلیدهای دیگر حفظ).
 *
 * اگر پروفایلی وجود دارد → فقط preferences به‌روزرسانی می‌شود. اگر نه → یک پروفایلِ
 * کمینه با fullNameِ fallback ساخته می‌شود تا ذخیره هرگز بی‌صدا شکست نخورد (fullName در
 * schema NOT NULL است). مقید به همان userId.
 *
 * @returns فیلترهای مؤثرِ پس از نوشتن + اینکه آیا پروفایل تازه ساخته شد.
 */
export async function writeApplyFilters(
  userId: string,
  filters: ApplyFilters,
  opts: { db?: FiltersDb; fallbackFullName?: string } = {},
): Promise<WriteApplyFiltersResult> {
  const db = opts.db ?? defaultDb;
  const now = new Date();

  const [existing] = await db
    .select({ id: candidateProfiles.id, preferences: candidateProfiles.preferences })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);

  const merged = mergeApplyFilters(existing?.preferences ?? null, filters);

  if (existing) {
    await db
      .update(candidateProfiles)
      .set({ preferences: merged, updatedAt: now })
      .where(eq(candidateProfiles.id, existing.id));
    return { filters: parseApplyFilters(merged), createdProfile: false };
  }

  const fullName = opts.fallbackFullName?.trim() || "کاربر کارجو";
  // onConflict: اگر بینِ select و insert یک ردیفِ هم‌زمان ساخته شد، به‌جای خطای یکتایی
  // یا ردیفِ تکراری، همان ردیف را با preferencesِ merged به‌روزرسانی کن (فیلترها گم نشوند).
  await db
    .insert(candidateProfiles)
    .values({ userId, fullName, preferences: merged })
    .onConflictDoUpdate({
      target: candidateProfiles.userId,
      set: { preferences: merged, updatedAt: now },
    });
  return { filters: parseApplyFilters(merged), createdProfile: true };
}

/**
 * فقط تاگلِ فیلترِ هوشمند (AI) را روشن/خاموش می‌کند (بدونِ دست‌زدن به بقیه‌ی فیلترها).
 * راحتی‌رسانِ Phase 4/Track C. مقید به همان userId.
 */
export async function setAiFilterEnabled(
  userId: string,
  enabled: boolean,
  opts: { db?: FiltersDb; fallbackFullName?: string } = {},
): Promise<WriteApplyFiltersResult> {
  const current = await readApplyFilters(userId, opts.db ?? defaultDb);
  return writeApplyFilters(userId, { ...current, aiFilterEnabled: enabled === true }, opts);
}
