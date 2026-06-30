import "server-only";

/**
 * GET /api/extension/me
 *
 * هویتِ نشستِ افزونه را برمی‌گرداند: کاربر + سایت‌های متصلش (فقط متادیتا).
 * احراز هویت با `Authorization: Bearer <extension token>` (همان توکنی که در
 * `/api/extension/link` صادر شد). فقط نشستِ نوعِ 'extension' پذیرفته می‌شود.
 *
 * قاعده‌ی ۴ (CONTEXT): فقط دادهٔ همین کاربر برمی‌گردد — کوئری‌ها به `userId`ِ
 * نشستِ احرازشده مقیدند؛ هرگز cross-user.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts, users } from "@/db/schema";
import { json, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه.
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) کاربر (متادیتای غیرحساس).
    const [user] = await db
      .select({
        id: users.id,
        phone: users.phone,
        fullName: users.fullName,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      // نشستِ معتبر ولی کاربر حذف شده — fail-closed.
      return json({ error: "user not found" }, 404);
    }

    // ۳) سایت‌های متصلِ همین کاربر (فقط متادیتا — نه نشست/کلید).
    const boards = await db
      .select({
        board: boardAccounts.board,
        status: boardAccounts.status,
        accountLabel: boardAccounts.accountLabel,
        lastConnectedAt: boardAccounts.lastConnectedAt,
      })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId));

    return json({ user, boards });
  });
}
