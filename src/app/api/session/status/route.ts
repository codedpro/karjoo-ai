import "server-only";

/**
 * GET /api/session/status
 *
 * وضعیتِ خزانه‌ی نشستِ هر سایتِ کاربرِ احرازشده را برمی‌گرداند (Track C — قاعده‌ی ۴).
 * برای هر سایتِ متصل: { board, connected, lastRefreshed, expiresAt, stale }.
 *
 *   • connected — آیا یک بلابِ نشستِ رمزشده برای این سایت در خزانه هست؟
 *   • stale     — آیا نشست منقضی شده (expiresAt گذشته) یا اصلاً نشستی در خزانه نیست؟
 *
 * مرزِ ایمنی (بحرانی): **هرگز** ciphertext/iv/keyVersion یا هیچ مادهٔ سری برنمی‌گردد —
 * فقط متادیتای زمان‌بندی. کوئری به userIdِ نشست مقید است (هیچ‌گاه نشستِ کاربرِ دیگر).
 *
 * احراز: نشستِ افزونه یا وب (Bearer) — خواندنی است (مثلِ GET /api/board-accounts).
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts, sessionBlobs } from "@/db/schema";
import { json, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** وضعیتِ خزانه‌ی نشست برای یک سایت — فقط متادیتا (بدونِ هیچ مادهٔ سری). */
interface SessionStatusEntry {
  board: string;
  /** آیا حسابِ سایت به‌عنوانِ connected علامت خورده است؟ */
  boardStatus: string;
  /** آیا یک بلابِ نشستِ رمزشده در خزانه موجود است؟ */
  connected: boolean;
  /** آخرین زمانِ refreshِ نشست (یا null اگر نشستی نباشد). */
  lastRefreshed: Date | null;
  /** زمانِ انقضای تخمینیِ نشست (یا null). */
  expiresAt: Date | null;
  /** نشست کهنه است: نبودِ نشست، یا گذشتنِ expiresAt. */
  stale: boolean;
}

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — افزونه یا وب (خواندنی، بدونِ requireKind).
    const { userId } = await requireBearerSession(request);

    // ۲) سایت‌های همین کاربر (مقید به userId). فقط متادیتا.
    const accounts = await db
      .select({
        id: boardAccounts.id,
        board: boardAccounts.board,
        status: boardAccounts.status,
      })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId));

    if (accounts.length === 0) {
      return json({ count: 0, boards: [] });
    }

    const now = Date.now();
    const entries: SessionStatusEntry[] = [];

    // ۳) برای هر حساب، جدیدترین بلابِ نشست را بخوان — *فقط* ستون‌های زمان‌بندی
    //    (هرگز ciphertext/iv/keyVersion). join به board_accounts با شرطِ userId تا
    //    قاعده‌ی ۴ مضاعفاً تضمین شود (هیچ بلابِ کاربرِ دیگر).
    for (const acc of accounts) {
      const [blob] = await db
        .select({
          lastRefreshed: sessionBlobs.lastRefreshed,
          expiresAt: sessionBlobs.expiresAt,
        })
        .from(sessionBlobs)
        .innerJoin(boardAccounts, eq(sessionBlobs.boardAccountId, boardAccounts.id))
        .where(
          and(
            eq(sessionBlobs.boardAccountId, acc.id),
            eq(boardAccounts.userId, userId),
          ),
        )
        .orderBy(desc(sessionBlobs.lastRefreshed))
        .limit(1);

      const connected = Boolean(blob);
      const expiresAt = blob?.expiresAt ?? null;
      const stale = !connected || (expiresAt ? expiresAt.getTime() <= now : false);

      entries.push({
        board: acc.board,
        boardStatus: acc.status,
        connected,
        lastRefreshed: blob?.lastRefreshed ?? null,
        expiresAt,
        stale,
      });
    }

    return json({ count: entries.length, boards: entries });
  });
}
