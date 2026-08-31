import "server-only";

/**
 * DELETE /api/board-accounts/disconnect — «قطعِ اتصالِ» یک حسابِ سایتِ کاریابی (نشستِ وب).
 *
 * با نشست وب یا Bearer افزونه احراز می‌شود. این فقط اتصال کارجو را قطع می‌کند و هیچ
 * کوکی یا نشست محلیِ مرورگر در سایت کاریابی را تغییر نمی‌دهد.
 *
 * قاعده‌ی ۴ (CONTEXT) + امنیت: کاربر همیشه از نشست گرفته می‌شود، نه از بدنه؛ هر عملیات به
 * همان userId مقید است. قطعِ اتصال دو کار را در یک تراکنش انجام می‌دهد:
 *   ۱) **بلابِ نشستِ خزانه (session_blobs) را حذف می‌کند** تا سرور دیگر نتواند با آن نشست
 *      به‌جای کاربر عمل کند — این هسته‌ی الزامِ امنیتی است.
 *   ۲) وضعیتِ boardAccounts را به needs_reauth برمی‌گرداند (ردیف می‌ماند برای تاریخچه/ممیزی).
 *      enumِ board_account_status مقدارِ «disconnected» ندارد؛ needs_reauth نزدیک‌ترین حالتِ
 *      موجودِ «قابلِ استفاده نیست، باید دوباره متصل شود» است (بدونِ تغییرِ schema).
 *
 * idempotent: قطعِ اتصالِ حسابی که قبلاً قطع شده باز هم ۲۰۰ می‌دهد (نه ۵۰۰). اگر حسابِ
 * (userId, board) اصلاً وجود نداشته باشد → ۴۰۴ (بدونِ فاشِ وجود).
 *
 * بدنه (JSON): { board }
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, boardAccounts, sessionBlobs } from "@/db/schema";
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { jobBoardSchema } from "@/lib/api/extension-schemas";

// به DB دست می‌زند (+ کوکیِ نشست) → اجرای Node و رندرِ پویا لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** بدنه — فقط شناسه‌ی سایت. `.strict()` هر فیلدِ ناشناخته را رد می‌کند (بدونِ مادهٔ سری). */
const disconnectBodySchema = z.object({ board: jobBoardSchema }).strict();

export async function DELETE(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) کاربر از نشست وب یا Bearer افزونه گرفته می‌شود، نه از بدنه.
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // ۲) اعتبارسنجیِ بدنه.
    const { board } = await parseJsonBody(request, disconnectBodySchema);

    // ۳) تراکنشِ اتمیک: حساب را *تحتِ همان کاربر* resolve کن، بلابِ خزانه را حذف کن و
    //    وضعیت را برگردان. اگر حساب به این کاربر تعلق نداشت، boardAccountId = null.
    const boardAccountId = await db.transaction(async (tx) => {
      const [acc] = await tx
        .select({ id: boardAccounts.id })
        .from(boardAccounts)
        .where(and(eq(boardAccounts.userId, user.id), eq(boardAccounts.board, board)))
        .limit(1);
      if (!acc) return null;

      // حذفِ بلابِ نشستِ خزانه — سرور دیگر نمی‌تواند با این نشست عمل کند (الزامِ امنیتی).
      await tx.delete(sessionBlobs).where(eq(sessionBlobs.boardAccountId, acc.id));

      // بازگرداندنِ وضعیت (idempotent — اگر از پیش needs_reauth بوده هم مشکلی نیست).
      await tx
        .update(boardAccounts)
        .set({ status: "needs_reauth", updatedAt: new Date() })
        .where(eq(boardAccounts.id, acc.id));

      return acc.id;
    });

    // حسابِ (userId, board) وجود ندارد/به این کاربر تعلق ندارد → ۴۰۴ (وجود را فاش نمی‌کنیم).
    if (!boardAccountId) return errorJson("حسابِ متصل یافت نشد.", 404);

    // ردِ ممیزی (append-only، همان جدولِ audit_events). best-effort — شکستش نباید قطعِ
    // اتصال را باطل کند (در لاگِ سرور دیده می‌شود). metadata فقط متادیتاست (هیچ مادهٔ سری).
    try {
      await db.insert(auditEvents).values({
        userId: user.id,
        boardAccountId,
        eventType: "session_expired",
        metadata: { action: "board_disconnected", board, channel: "karjoo" },
      });
    } catch (auditErr) {
      console.error("[board-disconnect] audit write failed:", auditErr);
    }

    return json({ ok: true, board, status: "needs_reauth" });
  });
}
