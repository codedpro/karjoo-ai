import "server-only";

/**
 * POST /api/board-accounts/connect
 *
 * یک حسابِ سایتِ کاریابی را برای کاربرِ احرازشده «متصل» اعلام می‌کند (upsert روی
 * (userId, board) → status='connected'). با نشستِ افزونه (Bearer) احراز می‌شود.
 *
 * قاعده‌ی ایمنیِ ۱ (CONTEXT) — **فقط متادیتا**: این اندپوینت هرگز مادهٔ سری (کوکی/
 * توکن/پسورد/credential) نمی‌پذیرد و ذخیره نمی‌کند. اسکیمای ورودی `.strict()` است؛
 * هر فیلدِ ناشناخته → ۴۰۰. تنها چیزی که ذخیره می‌شود: شناسه‌ی سایت، وضعیتِ connected
 * و یک برچسبِ نمایشیِ اختیاری. نشستِ خودِ کاربر در سایت فقط *محلی* (در مرورگرِ کاربر)
 * می‌ماند و هرگز به سرورِ کارجو منتقل نمی‌شود.
 *
 * بدنه (JSON): { board, accountLabel? }
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts } from "@/db/schema";
import { HttpError, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { boardConnectBodySchema } from "@/lib/api/extension-schemas";
import { isBoardLive } from "@/lib/apply/registry";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * شکلِ نشستِ هر سایت — متادیتای ثابتِ دامنه (نه مادهٔ سری). برای ستونِ NOT NULLِ
 * session_shape لازم است. جابینجا کوکی‌محور، جاب‌ویژن توکن‌محور (SPA) است؛ بقیه
 * فعلاً کوکی فرض می‌شوند (بخش ۷ سند معماری).
 */
const SESSION_SHAPE_BY_BOARD: Record<
  "jobvision" | "jobinja" | "e-estekhdam" | "irantalent" | "karboom" | "linkedin",
  "cookie" | "token"
> = {
  jobvision: "token",
  jobinja: "cookie",
  "e-estekhdam": "cookie",
  // irantalent یک SPA است (auth از مرورگرِ کاربر، شکلِ نشست token) — هم‌راستا با
  // session-schemas/افزونه؛ این ستون NOT NULL است پس باید برای هر boardِ معتبر مقدار داشته باشد.
  irantalent: "token",
  karboom: "cookie",
  linkedin: "cookie",
};

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه.
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) اعتبارسنجیِ بدنه. `.strict()` هر فیلدِ سری/ناشناخته را رد می‌کند (قاعده‌ی ۱).
    const body = await parseJsonBody(request, boardConnectBodySchema);

    // ۳) گیتِ زنده‌بودنِ سایت — پیش از هر نوشتنی در DB. فقط سایت‌های واقعاً کارکننده
    //    (BOARD_STATUS === "live") قابلِ اتصال‌اند؛ داربست‌ها (search/apply آن‌ها throw
    //    می‌کند) رد می‌شوند تا کاربر گمان نکند اتصالْ کاری می‌کند. ۴۰۹ (نه ۴۰۰) تا از
    //    خطای اعتبارسنجیِ بدنه (۴۰۰) قابلِ تمایز باشد؛ enumِ افزونه دست‌نخورده می‌ماند.
    if (!isBoardLive(body.board)) {
      throw new HttpError(
        409,
        "این سایت هنوز پشتیبانی نمی‌شود و به‌زودی اضافه می‌شود.",
      );
    }

    const now = new Date();
    const sessionShape = SESSION_SHAPE_BY_BOARD[body.board];

    // ۴) upsert روی یکتاییِ (userId, board) → connected. فقط متادیتا.
    await db
      .insert(boardAccounts)
      .values({
        userId,
        board: body.board,
        status: "connected",
        accountLabel: body.accountLabel ?? null,
        sessionShape,
        lastConnectedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [boardAccounts.userId, boardAccounts.board],
        set: {
          status: "connected",
          // برچسب را فقط در صورتِ ارسال به‌روزرسانی کن (تا برچسبِ قبلی پاک نشود).
          ...(body.accountLabel !== undefined
            ? { accountLabel: body.accountLabel }
            : {}),
          lastConnectedAt: now,
          updatedAt: now,
        },
      });

    // ۵) ردیفِ نهاییِ همین کاربر را بخوان و برگردان (فقط متادیتا).
    const [row] = await db
      .select({
        board: boardAccounts.board,
        status: boardAccounts.status,
        accountLabel: boardAccounts.accountLabel,
        lastConnectedAt: boardAccounts.lastConnectedAt,
      })
      .from(boardAccounts)
      .where(
        and(eq(boardAccounts.userId, userId), eq(boardAccounts.board, body.board)),
      )
      .limit(1);

    return json({ account: row }, 200);
  });
}
