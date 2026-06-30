import "server-only";

/**
 * GET /api/wallet — موجودیِ کیف‌پول + آخرین ردیف‌های دفترِ کاربرِ احرازشده (نشستِ وب).
 *
 * مصرف‌کننده‌ی هسته‌ی بیلینگِ Foundation است: موجودی را از `getBalance` می‌خواند (که
 * کیف‌پول را idempotent می‌سازد اگر نباشد → ۰) و ردیف‌های دفتر را *فقط-خواندنی* و
 * مقید به userIdِ نشست برمی‌گرداند. هیچ debit/credit اینجا انجام نمی‌شود.
 *
 * امنیت (قاعده‌ی ۴ CONTEXT — دادهٔ هر کاربر فقط برای همان کاربر): کاربرِ هدف از کوکیِ
 * نشست گرفته می‌شود، نه از کوئری؛ کوئریِ دفتر همیشه به همان userId مقید است. هیچ
 * ستونِ حساسی برنمی‌گردد (دفتر فقط مبلغ/نوع/توضیح است).
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, walletLedger } from "@/db/schema";
import { errorJson, json, parseSearchParams, withErrorHandling } from "@/lib/api/http";
import { walletQuerySchema } from "@/lib/api/billing-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { getBalance } from "@/lib/billing/wallet";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از کوکیِ نشست (نه از کوئری).
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) اعتبارسنجیِ کوئری (فقط اندازه‌ی فهرستِ دفتر).
    const { searchParams } = new URL(request.url);
    const { ledgerLimit } = parseSearchParams(searchParams, walletQuerySchema);

    // ۳) موجودی از هسته‌ی بیلینگ (کیف‌پول را می‌سازد اگر نباشد → ۰) + پلنِ کاربر.
    const [balanceToman, planRow] = await Promise.all([
      getBalance(user.id),
      db
        .select({ plan: users.plan })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1),
    ]);
    const plan = planRow[0]?.plan ?? "payg";

    // ۴) آخرین ردیف‌های دفتر — فقط-خواندنی، مقید به userIdِ نشست (قاعده‌ی ۴).
    const ledger = await db
      .select({
        id: walletLedger.id,
        kind: walletLedger.kind,
        amountToman: walletLedger.amountToman,
        balanceAfterToman: walletLedger.balanceAfterToman,
        refType: walletLedger.refType,
        description: walletLedger.description,
        createdAt: walletLedger.createdAt,
      })
      .from(walletLedger)
      .where(eq(walletLedger.userId, user.id))
      .orderBy(desc(walletLedger.createdAt))
      .limit(ledgerLimit);

    return json({
      balanceToman,
      plan,
      ledger,
    });
  });
}
