import "server-only";

/**
 * GET /api/board-accounts
 *
 * فهرستِ سایت‌های متصلِ کاربرِ احرازشده را برمی‌گرداند (فقط متادیتا). با نشستِ
 * افزونه یا وب (Bearer) قابلِ احراز است (برخلافِ connect که فقط افزونه است).
 *
 * قاعده‌ی ۴ (CONTEXT): فقط دادهٔ همین کاربر — کوئری به `userId`ِ نشست مقید است.
 * هیچ مادهٔ سری (نشست/کوکی/توکنِ سایت) اینجا ذخیره نشده و برنمی‌گردد.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts } from "@/db/schema";
import { json, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — افزونه یا وب (بدونِ requireKind).
    const { userId } = await requireBearerSession(request);

    // ۲) سایت‌های متصلِ همین کاربر.
    const boards = await db
      .select({
        board: boardAccounts.board,
        status: boardAccounts.status,
        accountLabel: boardAccounts.accountLabel,
        lastConnectedAt: boardAccounts.lastConnectedAt,
      })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId));

    return json({ count: boards.length, boards });
  });
}
