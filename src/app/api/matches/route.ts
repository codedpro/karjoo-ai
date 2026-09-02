import "server-only";

/**
 * GET /api/matches?status=<...>&limit=<n>&offset=<n>
 *
 * فهرستِ تطبیق‌های ذخیره‌شده‌ی کاربرِ احرازشده را برمی‌گرداند (با اطلاعاتِ آگهیِ مرتبط).
 * فقط-خواندنی، با اعتبارسنجیِ کوئری و صفحه‌بندی. هیچ داده‌ی حساسی (نشست/کلید) برنمی‌گردد.
 *
 * امنیت (قاعده‌ی ۴ CONTEXT — دادهٔ هر کاربر فقط برای همان کاربر): کاربرِ هدف از نشستِ
 * احرازشده (Bearer — افزونه یا وب) گرفته می‌شود، نه از کوئری. پیش‌تر userId از کوئری
 * خوانده می‌شد که به هر صدازننده‌ی ناشناس اجازه می‌داد با حدسِ UUID تطبیق‌های هر کاربری
 * را بخواند؛ آن حفره با مقیدکردنِ کوئری به userIdِ نشست بسته شد.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobListings, matches } from "@/db/schema";
import { json, parseSearchParams, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { matchesQuerySchema } from "@/lib/api/schemas";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — افزونه یا وب (بدونِ requireKind). userId از نشست، نه از کوئری.
    const { userId } = await requireBearerSession(request);

    // ۲) اعتبارسنجیِ کوئری (فقط status/limit/offset؛ userId دیگر از بیرون گرفته نمی‌شود).
    const { searchParams } = new URL(request.url);
    const query = parseSearchParams(searchParams, matchesQuerySchema);

    // ۳) شرطِ where: همیشه userIdِ نشست؛ به‌علاوه‌ی status در صورت وجود (قاعده‌ی ۴).
    const freshness = sql`
      ${jobListings.postedAt} >= now() - (${MAX_PROVIDER_SYNC_AGE_DAYS}::text || ' days')::interval
    `;
    const where = query.status
      ? and(eq(matches.userId, userId), eq(matches.status, query.status), freshness)
      : and(eq(matches.userId, userId), freshness);

    // ۴) خواندن با join به آگهی — فقط ستون‌های لازم و غیرحساس.
    const rows = await db
      .select({
        id: matches.id,
        listingId: matches.listingId,
        score: matches.score,
        status: matches.status,
        reason: matches.reason,
        coverLetter: matches.coverLetter,
        scoredAt: matches.scoredAt,
        createdAt: matches.createdAt,
        listing: {
          board: jobListings.board,
          title: jobListings.title,
          company: jobListings.company,
          city: jobListings.city,
          url: jobListings.url,
          salary: jobListings.salary,
          postedAt: jobListings.postedAt,
        },
      })
      .from(matches)
      .innerJoin(jobListings, eq(matches.listingId, jobListings.id))
      .where(where)
      .orderBy(desc(matches.score), desc(matches.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    // ۵) پاسخِ نوع‌دار با متادیتای صفحه‌بندی.
    return json({
      userId,
      count: rows.length,
      limit: query.limit,
      offset: query.offset,
      matches: rows,
    });
  });
}
