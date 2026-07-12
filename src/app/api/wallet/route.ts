import "server-only";

/**
 * GET /api/wallet — موجودیِ کیف‌پولِ *واحدِ 1xai* + آخرین ردیف‌های دفترِ محلی (نشستِ وب).
 *
 * «یک انسان، یک موجودی»: پول در 1xai زندگی می‌کند — موجودی از `getUnifiedBalance`
 * (availableToman = balance − held) خوانده می‌شود، نه از کیف‌پولِ محلیِ بازنشسته.
 * دفترِ محلی فقط به‌عنوانِ *تاریخچه* برمی‌گردد. هیچ debit/credit اینجا انجام نمی‌شود.
 *
 * fail-closed روی موجودی: اگر سرویسِ 1xai در دسترس نباشد یا گره برقرار نشود → ۵۰۳
 * (هرگز موجودیِ مثبتِ جعلی برنمی‌گردد؛ قاعده‌ی ۱ CONTEXT).
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
import { getUnifiedBalance, OnexaiLinkError } from "@/lib/billing/unified";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";

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

    // ۳) موجودیِ واحد از 1xai — fail-closed: svc/گره برقرار نشد → ۵۰۳ (نه موجودیِ جعلی).
    let balanceToman: number;
    try {
      balanceToman = (await getUnifiedBalance(user.id)).availableToman;
    } catch (err) {
      if (err instanceof OnexaiSvcUnavailableError || err instanceof OnexaiLinkError) {
        return errorJson("کیف‌پولِ 1xai در دسترس نیست", 503);
      }
      throw err;
    }

    // ۴) پلنِ کاربر (محلی — پلن استحقاقِ کارجوست، نه پول).
    const planRow = await db
      .select({ plan: users.plan })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const plan = planRow[0]?.plan ?? "payg";

    // ۵) آخرین ردیف‌های دفترِ محلی (تاریخچه) — فقط-خواندنی، مقید به userIdِ نشست (قاعده‌ی ۴).
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
