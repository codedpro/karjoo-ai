import "server-only";

/**
 * لایه‌ی دسترسی به DB برای علاقه‌مندی/دسته‌بندیِ کاربر (Track B، WF1).
 *
 * همه‌ی توابع به userId محدودند (قاعده‌ی §10 — داده‌ی هر کاربر فقط برای همان کاربر) و
 * db تزریق‌پذیر است تا route handlerها بدونِ DB/شبکه تست شوند. این لایه «نوشتنِ
 * علاقه‌مندی» و «همگام‌سازیِ مشتقاتِ آن با preferencesِ پروفایل» را اتمیک نگه می‌دارد:
 * جایگزینیِ کاملِ user_interests + بازنویسیِ titles/categories در candidate_profiles.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { candidateProfiles, jobCategories, userInterests } from "@/db/schema";
import { mergeInterestPreferences } from "@/lib/interests/to-preferences";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد (همان کلاینتِ Drizzle). */
type InterestsDb = typeof defaultDb;

/**
 * slugِ دسته‌های انتخابیِ کاربر را برمی‌گرداند (با join به job_categories تا فقط
 * دسته‌های موجود برگردند). ترتیب با sortOrder تا UI پایدار بماند.
 */
export async function getSelectedSlugs(
  userId: string,
  db: InterestsDb = defaultDb,
): Promise<string[]> {
  const rows = await db
    .select({ slug: jobCategories.slug, sortOrder: jobCategories.sortOrder })
    .from(userInterests)
    .innerJoin(jobCategories, eq(userInterests.categoryId, jobCategories.id))
    .where(eq(userInterests.userId, userId));

  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.slug);
}

/** نتیجه‌ی جایگزینیِ علاقه‌مندی‌ها — slugهای نهایی + شمارش. */
export interface ReplaceInterestsResult {
  /** slugهای معتبری که واقعاً ذخیره شدند (نامعتبر/ناشناخته حذف شده). */
  appliedSlugs: string[];
  /** تعدادِ دسته‌های انتخابیِ نهایی. */
  count: number;
}

/**
 * کاربر دسته‌هایی خواست ولی **هیچ‌کدام** در تاکسونومی پیدا نشد.
 *
 * تقریباً همیشه یعنی جدولِ `job_categories` seed نشده (نه این‌که کاربر ۱۰ تا slugِ
 * بی‌معنی فرستاده). پیش‌تر این حالت بی‌صدا رد می‌شد و — چون جایگزینی «کامل» است —
 * علاقه‌مندی‌های قبلیِ کاربر و titles/categoriesِ پروفایلش را **پاک می‌کرد** و count=0
 * برمی‌گرداند. حالا fail-closed است: هیچ چیزی حذف نمی‌شود و مسیر ۵۰۳ می‌دهد.
 */
export class EmptyTaxonomyError extends Error {
  constructor(readonly requestedCount: number) {
    super("job taxonomy is unavailable — refusing to replace interests");
    this.name = "EmptyTaxonomyError";
  }
}

/**
 * مجموعه‌ی علاقه‌مندیِ کاربر را با slugهای داده‌شده **جایگزینِ کامل** می‌کند، سپس
 * مشتقاتِ آن (titles/categories) را در preferencesِ پروفایلِ کاربر همگام می‌کند.
 *
 * گام‌ها (در یک تراکنش، اتمیک):
 *   ۱) slugهای ورودی را به ردیف‌های معتبرِ job_categories تبدیل کن (ناشناخته حذف).
 *   ۲) همه‌ی user_interestsِ این کاربر را پاک و ردیف‌های تازه را درج کن (جایگزینی).
 *   ۳) اگر پروفایلی هست، titles/categories را در preferences بازنویسی کن (بقیه دست‌نخورده).
 *      اگر پروفایلی نیست، می‌گذریم — اولین آپلودِ رزومه پروفایل را می‌سازد و بعداً
 *      دوباره فراخوانی این تابع همگام می‌کند.
 *
 * userId از نشست می‌آید، نه از ورودیِ کلاینت (مقیدسازیِ §10).
 */
export async function replaceInterests(
  userId: string,
  requestedSlugs: readonly string[],
  db: InterestsDb = defaultDb,
): Promise<ReplaceInterestsResult> {
  return db.transaction(async (tx) => {
    // ۱) slug → ردیفِ دسته (فقط slugهای موجود). یکتاسازیِ ورودی.
    const uniqueRequested = [...new Set(requestedSlugs)];
    const categoryRows =
      uniqueRequested.length === 0
        ? []
        : await tx
            .select({ id: jobCategories.id, slug: jobCategories.slug })
            .from(jobCategories)
            .where(inArray(jobCategories.slug, uniqueRequested));

    const appliedSlugs = categoryRows.map((c) => c.slug);

    // ۱.۵) گاردِ fail-closed: کاربر چیزی خواست ولی هیچ‌کدام resolve نشد → تاکسونومی
    //      در دسترس نیست (معمولاً seed نشده). چون گامِ بعدی «حذفِ کامل» است، ادامه دادن
    //      یعنی پاک‌کردنِ خاموشِ انتخاب‌های قبلیِ کاربر. پس تراکنش را می‌شکنیم (rollback).
    //      حالتِ «پاک‌کردنِ عمدیِ همه» (ورودیِ خالی) همچنان مجاز است.
    if (uniqueRequested.length > 0 && categoryRows.length === 0) {
      throw new EmptyTaxonomyError(uniqueRequested.length);
    }

    // ۲) جایگزینیِ کامل: حذفِ علاقه‌مندی‌های قبلی، سپس درجِ تازه‌ها.
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    if (categoryRows.length > 0) {
      await tx
        .insert(userInterests)
        .values(categoryRows.map((c) => ({ userId, categoryId: c.id })));
    }

    // ۳) همگام‌سازیِ مشتقات با preferencesِ پروفایل (اگر پروفایل وجود دارد).
    const [profile] = await tx
      .select({ id: candidateProfiles.id, preferences: candidateProfiles.preferences })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1);

    if (profile) {
      const merged = mergeInterestPreferences(profile.preferences, appliedSlugs);
      await tx
        .update(candidateProfiles)
        .set({ preferences: merged, updatedAt: new Date() })
        .where(
          and(
            eq(candidateProfiles.id, profile.id),
            eq(candidateProfiles.userId, userId),
          ),
        );
    }

    return { appliedSlugs, count: appliedSlugs.length };
  });
}

/** همه‌ی دسته‌های تاکسونومی از DB (id/slug/برچسب/والد/ترتیب) — برای GET /api/categories. */
export interface CategoryRow {
  id: string;
  slug: string;
  labelFa: string;
  labelEn: string;
  parentId: string | null;
  sortOrder: number;
}

export async function getAllCategories(
  db: InterestsDb = defaultDb,
): Promise<CategoryRow[]> {
  const rows = await db
    .select({
      id: jobCategories.id,
      slug: jobCategories.slug,
      labelFa: jobCategories.labelFa,
      labelEn: jobCategories.labelEn,
      parentId: jobCategories.parentId,
      sortOrder: jobCategories.sortOrder,
    })
    .from(jobCategories);

  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}
