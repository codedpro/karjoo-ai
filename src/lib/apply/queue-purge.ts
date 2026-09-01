import "server-only";

/**
 * پاک‌کردنِ آگهی‌های در نوبتِ صف.
 *
 * چرا لازم است: صف با فیلترهای همان لحظه ساخته می‌شود. اگر بعداً بفهمی یکی از
 * دسته‌ها را نمی‌خواستی، برداشتنِ آن دسته فقط جلوی کشفِ *بعدی* را می‌گیرد — آگهی‌های
 * قبلاً صف‌شده سرِ جایشان می‌مانند و اپلای می‌شوند. و چون دسته‌ی مبدأ روی خودِ آگهی
 * ذخیره نمی‌شود، نمی‌شود «فقط دسته‌ی فلان» را از صف بیرون کشید؛ کاری که می‌شود کرد
 * خالی‌کردنِ نوبتِ همان سایت و گذاشتنِ کشف است تا با فیلترِ درست دوباره پرش کند.
 *
 * فقط ردیف‌های `pending` حذف می‌شوند: کارِ در جریان (leased) و کلِ تاریخچه
 * (succeeded/failed/dead) و ردیف‌های applications دست‌نخورده می‌مانند.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { jobListings, matches, tasks } from "@/db/schema";
import type { ActiveApplyBoard } from "@/lib/apply/filters";

export interface QueueCount {
  board: string;
  pending: number;
}

/** چند آگهی از هر سایت در نوبت است (برای نمایش پیش از پاک‌کردن). */
export async function countPendingByBoard(
  userId: string,
  conn: typeof defaultDb = defaultDb,
): Promise<QueueCount[]> {
  const rows = await conn
    .select({ board: jobListings.board, pending: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(matches, eq(matches.id, tasks.matchId))
    .innerJoin(jobListings, eq(jobListings.id, matches.listingId))
    .where(and(eq(matches.userId, userId), eq(tasks.status, "pending")))
    .groupBy(jobListings.board);
  return rows.map((r) => ({ board: r.board as string, pending: Number(r.pending) }));
}

/**
 * نوبتِ همین کاربر را خالی می‌کند (اختیاری: فقط یک سایت). تعدادِ حذف‌شده را برمی‌گرداند.
 * مقید به userId — هرگز صفِ کاربرِ دیگری را دست نمی‌زند.
 */
export async function pursePendingQueue(
  userId: string,
  board: ActiveApplyBoard | null,
  conn: typeof defaultDb = defaultDb,
): Promise<number> {
  const owned = conn
    .select({ id: matches.id })
    .from(matches)
    .innerJoin(jobListings, eq(jobListings.id, matches.listingId))
    .where(
      board
        ? and(eq(matches.userId, userId), eq(jobListings.board, board))
        : eq(matches.userId, userId),
    );

  const deleted = await conn
    .delete(tasks)
    .where(and(eq(tasks.status, "pending"), inArray(tasks.matchId, owned)))
    .returning({ id: tasks.id });
  return deleted.length;
}
