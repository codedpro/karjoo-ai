import "server-only";

/**
 * مسیرهای پلنِ کاربرِ احرازشده (نشستِ وب):
 *   • GET  /api/me/plan — پلنِ فعلی + وضعیتِ گرنتِ ماهِ جاری + اپلای امروز/سهمیه + موجودی.
 *   • POST /api/me/plan — تغییرِ پلن (DEV: مستقیم users.plan را ست می‌کند و در صورتِ
 *     ارتقا grantMonthlyCredits را اعمال می‌کند؛ پرداختِ واقعی یک TODO seam است).
 *
 * امنیت (قاعده‌ی ۴ CONTEXT — دادهٔ هر کاربر فقط برای همان کاربر): کاربرِ هدف همیشه از
 * کوکیِ نشست گرفته می‌شود، نه از بدنه/کوئری؛ بدنه فقط کلیدِ پلنِ مقصد را دارد و با zod
 * اعتبارسنجی می‌شود. هیچ userId از کلاینت پذیرفته نمی‌شود.
 *
 * توجه: این فایل از فایل‌های مالکیتیِ Foundation نیست؛ صرفاً مصرف‌کننده‌ی
 * plans.ts/grants.ts/apply-quota.ts/ai-budget.ts است (Track A).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { changePlanBodySchema } from "@/lib/api/plan-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { planFor, type PlanKey } from "@/lib/billing/plans";
import { cardToCardInfo } from "@/lib/env";
import { createPaymentRequest } from "@/lib/billing/payments";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // ۵) ارتقا → پرداختِ کارت‌به‌کارت لازم است. پلن *تغییر نمی‌کند*؛ یک درخواستِ pending
    //    ساخته می‌شود و پس از تأییدِ ادمین، پلن ارتقا و گرنتِ ماهانه اعمال می‌شود.
    const card = cardToCardInfo();
    if (!card) {
      return errorJson("پرداختِ کارت‌به‌کارت هنوز پیکربندی نشده است.", 503);
    }

    const req = await createPaymentRequest(user.id, {
      kind: "plan",
      targetPlan: target as PlanKey,
      amountToman: targetDef.priceToman,
    });

    return json(
      {
        ok: true,
        pending: true,
        upgraded: false,
        targetPlan: target,
        definition: targetDef,
        request: {
          id: req.id,
          amountToman: req.amountToman,
          status: req.status,
          targetPlan: req.targetPlan,
          createdAt: req.createdAt,
        },
        card,
      },
      201,
    );
  });
}
