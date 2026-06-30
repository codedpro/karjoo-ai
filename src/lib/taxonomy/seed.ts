import "server-only";

/**
 * seedِ ایدمپوتنتِ تاکسونومیِ دسته‌بندیِ مشاغل در جدولِ job_categories.
 *
 * از JOB_CATEGORY_SEED (منبعِ حقیقتِ خالص) ردیف‌ها را upsert می‌کند: بر اساسِ slugِ
 * یکتا، برچسب/ترتیب را به‌روزرسانی و ردیفِ تازه را درج می‌کند. چون onConflictِ slug
 * استفاده می‌شود، اجرای چندباره امن است (هیچ تکراری/خطایی). انتخاب‌های کاربر
 * (user_interests) دست‌نخورده می‌مانند چون slug پایدار است.
 *
 * این را در اسکریپتِ راه‌اندازی/مهاجرت صدا بزنید (نه در مسیرِ درخواست). تزریقِ db برای
 * تستِ یکپارچه؛ در مسیرِ واقعی از کلاینتِ پیش‌فرض استفاده می‌شود.
 */
import { db as defaultDb } from "@/db";
import { jobCategories } from "@/db/schema";
import { JOB_CATEGORY_SEED } from "@/lib/taxonomy/categories";

/** نتیجه‌ی seed: چند ردیف upsert شد. */
export interface SeedCategoriesResult {
  upserted: number;
}

/**
 * تاکسونومی را در DB می‌نشاند (upsert بر اساسِ slug). ایدمپوتنت.
 *
 * @param db کلاینتِ Drizzle (پیش‌فرض: کلاینتِ سراسری). برای تستِ یکپارچه تزریق‌پذیر.
 */
export async function seedJobCategories(
  db: typeof defaultDb = defaultDb,
): Promise<SeedCategoriesResult> {
  const rows = JOB_CATEGORY_SEED.map((c) => ({
    slug: c.slug,
    labelFa: c.labelFa,
    labelEn: c.labelEn,
    sortOrder: c.sortOrder,
  }));

  await db
    .insert(jobCategories)
    .values(rows)
    .onConflictDoUpdate({
      target: jobCategories.slug,
      set: {
        labelFa: sqlExcluded("label_fa"),
        labelEn: sqlExcluded("label_en"),
        sortOrder: sqlExcluded("sort_order"),
      },
    });

  return { upserted: rows.length };
}

/**
 * ارجاع به مقدارِ EXCLUDED (ردیفِ درجِ ناموفق) در onConflictDoUpdate — برای به‌روزرسانیِ
 * ستون با مقدارِ تازه‌ی همان درج. از sql خامِ drizzle استفاده می‌کند.
 */
import { sql } from "drizzle-orm";
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
