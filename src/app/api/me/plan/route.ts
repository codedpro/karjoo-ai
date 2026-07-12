import "server-only";

/**
 * مسیرهای پلنِ کاربرِ احرازشده (نشستِ وب):
 *   • GET  /api/me/plan — پلنِ فعلی + وضعیتِ گرنتِ ماهِ جاری + اپلای امروز/سهمیه + موجودی.
 *   • POST /api/me/plan — تغییرِ پلن. پایین‌آوردن/همان پلن فوری اعمال می‌شود؛ *ارتقا*
 *     از ماشینِ حالتِ ضدِکرشِ purchasePlan (plan-purchase.ts) می‌گذرد: هر خرید یک ردیفِ
 *     plan_purchases با referenceِ *بدونِ زمان* (plan:<rowId>) دارد، پس retry پس از هر
 *     کرشی — حتی پس از رفتنِ ماهِ UTC — به همان reference می‌رسد و دوباره‌کسر ساختاری
 *     ناممکن است. هیچ تأییدِ ادمین/گرنتِ ماهانه‌ای وجود ندارد — پلن = استحقاق + قیمت.
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
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { OnexaiLinkError } from "@/lib/billing/unified";
import {
  PurchaseConflictError,
  purchasePlan,
  settleOpenPurchase,
} from "@/lib/billing/plan-purchase";
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

    // ۴) پایین‌آوردن یا همان پلن (بدونِ هزینه‌ی بیشتر) → فوری اعمال می‌شود، اما *اول*
    //    هر خریدِ بازِ به‌جامانده settle می‌شود (خنثیِ مالی): وگرنه پولِ یک ارتقایِ
    //    کرش‌کرده (debited بدونِ پلن) با دور زدنِ ماشین برای همیشه معلق می‌ماند.
    if (!isUpgrade) {
      try {
        await settleOpenPurchase(user.id);
      } catch (err) {
        if (err instanceof PurchaseConflictError) {
          return errorJson(err.message, 409);
        }
        if (err instanceof OnexaiSvcUnavailableError || err instanceof OnexaiLinkError) {
          // تکلیفِ پولِ معلق بدونِ svc روشن نمی‌شود → پایین‌آوردن هم صبر کند (fail-closed).
          return errorJson("کیف‌پولِ 1xai در دسترس نیست", 503);
        }
        throw err;
      }
      await db
        .update(users)
        .set({ plan: target, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return json({ ok: true, upgraded: false, plan: target, definition: targetDef });
    }

    // ۵) ارتقا → ماشینِ حالتِ ضدِکرش: ردیفِ plan_purchases با referenceِ بدونِ زمان،
    //    کسرِ idempotent، سپس ثبتِ پلن + completed. هر کرش/دوکلیکی retryپذیر است و
    //    دوباره‌کسر ساختاری ناممکن (جزئیات و اثباتِ حالت‌ها در plan-purchase.ts).
    let balanceToman: number;
    try {
      const result = await purchasePlan(user.id, target, targetDef.priceToman);
      balanceToman = result.balanceToman;
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // موجودیِ واحد کافی نیست → ۴۰۲ + نشانیِ شارژ (فقط در داشبوردِ 1xai).
        return json({ error: err.message, topupUrl: ONEXAI_TOPUP_URL }, 402);
      }
      if (err instanceof PurchaseConflictError) {
        // درخواستِ هم‌زمانِ ناسازگار (دوکلیک/دو تب) — retryِ کوتاه‌مدت امن است.
        return errorJson(err.message, 409);
      }
      if (err instanceof OnexaiSvcUnavailableError || err instanceof OnexaiLinkError) {
        // گیتِ پول fail-closed است: svc/گره برقرار نشد → ۵۰۳، هیچ ارتقایی رخ نمی‌دهد؛
        // خریدِ باز می‌ماند و retryِ بعدی از همان reference ادامه می‌دهد.
        return errorJson("کیف‌پولِ 1xai در دسترس نیست", 503);
      }
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
