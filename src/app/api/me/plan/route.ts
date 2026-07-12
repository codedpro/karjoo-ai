import "server-only";

/**
 * مسیرهای پلنِ کاربرِ احرازشده (نشستِ وب):
 *   • GET  /api/me/plan — پلنِ فعلی + وضعیتِ گرنتِ ماهِ جاری + اپلای امروز/سهمیه + موجودی.
 *   • POST /api/me/plan — تغییرِ پلن. پایین‌آوردن/همان پلن فوری اعمال می‌شود؛ *ارتقا*
 *     قیمتِ پلن را همان لحظه از کیف‌پولِ واحدِ 1xai کسر می‌کند (debitUnified، idempotent
 *     با referenceِ پایدارِ `plan:{userId}:{plan}:{YYYY-MM}`) و سپس users.plan ست می‌شود.
 *     هیچ درخواستِ pending/تأییدِ ادمین/گرنتِ ماهانه‌ای دیگر وجود ندارد — پلن = استحقاق + قیمت.
 *
 * ترتیبِ پول (بحرانی): اول debit، بعد ثبتِ پلن. اگر ثبتِ پلن پس از debitِ موفق شکست
 * بخورد، بلند لاگ می‌کنیم و خطا بالا می‌رود — retryِ کاربر با همان reference بی‌اثرِ
 * مالی است (idempotent سمتِ 1xai) و فقط پلن را ست می‌کند.
 *
 * امنیت (قاعده‌ی ۴ CONTEXT — دادهٔ هر کاربر فقط برای همان کاربر): کاربرِ هدف همیشه از
 * کوکیِ نشست گرفته می‌شود، نه از بدنه/کوئری؛ بدنه فقط کلیدِ پلنِ مقصد را دارد و با zod
 * اعتبارسنجی می‌شود. هیچ userId از کلاینت پذیرفته نمی‌شود.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { changePlanBodySchema } from "@/lib/api/plan-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { planFor, type PlanKey } from "@/lib/billing/plans";
import { periodMonthOf } from "@/lib/billing/ai-budget";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { debitUnified, OnexaiLinkError } from "@/lib/billing/unified";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** نشانیِ یکتای شارژِ کیف‌پولِ واحد — تنها جایی که پول واردِ خانواده می‌شود. */
const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

/* ─────────────────────────────  GET /api/me/plan  ───────────────────────────── */

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از کوکیِ نشست (نه از کوئری).
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) وضعیتِ کاملِ پلن — مقید به userIdِ نشست، فقط-خواندنی (هیچ نوشتنی).
    const status = await getUserPlanStatus(user.id);
    const def = planFor(status.planKey);

    return json({
      plan: status.planKey,
      definition: def,
      balanceToman: status.balanceToman,
      grant: status.grant,
      apply: status.apply,
    });
  });
}

/* ─────────────────────────────  POST /api/me/plan  ──────────────────────────── */

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از کوکیِ نشست (نه از بدنه).
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) اعتبارسنجیِ بدنه — فقط کلیدِ پلنِ مقصد (۴۰۰ در صورتِ نامعتبر).
    const { plan: target } = await parseJsonBody(request, changePlanBodySchema);

    // ۳) پلنِ فعلی برای تشخیصِ ارتقا (قیمتِ مقصد > قیمتِ فعلی → پرداخت لازم است).
    const [row] = await db
      .select({ plan: users.plan })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const currentRaw = row?.plan ?? "free";
    const currentDef = planFor(currentRaw);
    const targetDef = planFor(target as PlanKey);
    const isUpgrade = targetDef.priceToman > currentDef.priceToman;

    // ۴) پایین‌آوردن یا همان پلن (بدونِ هزینه‌ی بیشتر) → فوری اعمال می‌شود (نیازی به پرداخت نیست).
    if (!isUpgrade) {
      await db
        .update(users)
        .set({ plan: target, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return json({ ok: true, upgraded: false, plan: target, definition: targetDef });
    }

    // ۵) ارتقا → کسرِ فوریِ قیمتِ پلن از کیف‌پولِ واحدِ 1xai. reference برای «همین
    //    رویداد» پایدار است (کاربر+پلن+ماه؛ بدونِ Date.now())، پس retry بی‌اثرِ مالی است.
    const period = periodMonthOf(Date.now());
    const reference = `plan:${user.id}:${target}:${period}`;
    let balanceToman: number;
    try {
      const move = await debitUnified(user.id, targetDef.priceToman, reference);
      balanceToman = move.balanceToman;
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // موجودیِ واحد کافی نیست → ۴۰۲ + نشانیِ شارژ (فقط در داشبوردِ 1xai).
        return json({ error: err.message, topupUrl: ONEXAI_TOPUP_URL }, 402);
      }
      if (err instanceof OnexaiSvcUnavailableError || err instanceof OnexaiLinkError) {
        // گیتِ پول fail-closed است: svc/گره برقرار نشد → ۵۰۳، هیچ ارتقایی رخ نمی‌دهد.
        return errorJson("کیف‌پولِ 1xai در دسترس نیست", 503);
      }
      throw err;
    }

    // ۶) debit موفق بود → حالا پلن ست می‌شود. اگر این نوشتن شکست بخورد، *بلند* لاگ
    //    می‌کنیم: پول کسر شده ولی پلن ست نشده — retryِ کاربر با همان reference فقط
    //    پلن را ست می‌کند (debit تکرار نمی‌شود؛ idempotent سمتِ 1xai).
    try {
      await db
        .update(users)
        .set({ plan: target, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    } catch (err) {
      console.error(
        `[billing] CRITICAL: debitِ ارتقا موفق بود (ref=karjoo:${reference}, ${targetDef.priceToman} تومان) اما ثبتِ users.plan شکست خورد — retry امن است:`,
        err,
      );
      throw err;
    }

    return json({
      ok: true,
      upgraded: true,
      plan: target,
      definition: targetDef,
      balanceToman,
    });
  });
}
