import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { filterCursors } from "@/db/schema";
import type { JobPreferences } from "@/lib/apply/types";

/**
 * مکان‌نمای صفحه‌بندیِ فیلترمود.
 *
 * هدف: اجراهای پیاپیِ `runFilterApply` برای یک کاربر، به‌جای اسکنِ همیشگیِ چند صفحه‌ی
 * نخستِ نتایج (و برخوردنِ سقفِ ~۲۵ آگهی)، در عمقِ نتایج پیش بروند. مکان‌نما به‌ازای
 * (کاربر × سایت × امضای فیلتر) نگه‌داری می‌شود؛ با تغییرِ فیلترها امضا عوض می‌شود و از
 * صفحه‌ی ۱ آغاز می‌شویم. رسیدن به انتها → بازنشانی به ۱.
 */

/** حداقل قراردادِ DB که این ماژول لازم دارد (سازگار با OrchestratorDb). */
export type CursorDb = Pick<Database, "query" | "insert">;

/**
 * امضای پایدارِ فیلترهای هدف‌گیری — نرمال‌سازی و مرتب‌شده تا ترتیب/حروف‌بزرگ مهم نباشد.
 * فقط میدان‌هایی که *نتیجه‌ی جست‌وجو* را عوض می‌کنند وارد امضا می‌شوند (عنوان، شهر،
 * دسته، نوع، دورکاری، حداقلِ حقوق، مرتب‌سازی). تغییرِ هرکدام = مکان‌نمای نو از صفحه‌ی ۱.
 */
export function computeFilterSignature(prefs: JobPreferences): string {
  const norm = (arr?: string[]): string[] =>
    [...(arr ?? [])]
      .map((s) => (s ?? "").trim().toLowerCase())
      .filter((s) => s.length > 0)
      .sort();
  const shape = {
    t: norm(prefs.titles),
    c: norm(prefs.cities),
    cat: norm(prefs.categorySlugs),
    jt: norm(prefs.jobTypes),
    r: prefs.remoteOnly ? 1 : 0,
    s: typeof prefs.minSalary === "number" && prefs.minSalary > 0 ? prefs.minSalary : 0,
    sort: (prefs.sort ?? "").trim(),
  };
  return JSON.stringify(shape);
}

/** صفحه‌ای که اجرای بعدی باید از آن آغاز کند (پیش‌فرضِ نبودِ ردیف: ۱). */
export async function readFilterCursor(
  conn: CursorDb,
  userId: string,
  board: string,
  filterSig: string,
): Promise<number> {
  const row = await conn.query.filterCursors.findFirst({
    where: and(
      eq(filterCursors.userId, userId),
      eq(filterCursors.board, board),
      eq(filterCursors.filterSig, filterSig),
    ),
  });
  const page = row?.nextPage ?? 1;
  // گاردِ سلامت: هرگز کمتر از ۱.
  return page >= 1 ? page : 1;
}

/**
 * مکان‌نما را روی `nextPage` می‌نشاند (upsert؛ ۱-مبنا، حداقل ۱). idempotent و امن در برابر
 * اجراهای هم‌زمان (کلیدِ یکتا روی user×board×sig).
 */
export async function advanceFilterCursor(
  conn: CursorDb,
  userId: string,
  board: string,
  filterSig: string,
  nextPage: number,
): Promise<void> {
  const next = Number.isFinite(nextPage) && nextPage >= 1 ? Math.floor(nextPage) : 1;
  await conn
    .insert(filterCursors)
    .values({ userId, board, filterSig, nextPage: next })
    .onConflictDoUpdate({
      target: [filterCursors.userId, filterCursors.board, filterCursors.filterSig],
      set: { nextPage: next, updatedAt: sql`now()` },
    });
}
