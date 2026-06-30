import "server-only";

/**
 * خواندنِ «زمینه‌ی هزینه‌ی AIِ کاربر» برای داشبورد (server-side, فقط-خواندنی).
 *
 * هدفِ Track C: صفحه‌های کنشِ پولی (رزومه/تطبیق‌ها) بتوانند پیش از کنش، «حدودِ هزینه»
 * و موجودی/پلن را نشان دهند و در صورتِ نیاز پرامپتِ شارژ را زودتر بیاورند — بدونِ آنکه
 * هسته‌ی متر/استحقاقِ Foundation تغییر کند. این لایه فقط:
 *   • مدلِ مؤثرِ کاربر را حل می‌کند (همان قاعده‌ی Foundation#resolveUserModel)،
 *   • قیمتِ آن را از کاتالوگ می‌خواند (Foundation#priceFor)،
 *   • موجودی/پلن را می‌خواند (Foundation#getBalance + جدولِ users)،
 *   • و یک CostEstimateِ خالص (lib/billing/ui) برای هر کنشِ پولی می‌سازد.
 *
 * هیچ کسری/متری انجام نمی‌شود؛ صرفاً نمایش. اگر کاتالوگ خالی/مدل ناشناخته بود، به‌جای
 * throw، `null` برمی‌گردد تا UI بی‌سروصدا تخمین را حذف کند (کنش همچنان کار می‌کند؛
 * گیتِ واقعی سمتِ سرور در metering هسته است).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users, type Plan } from "@/db/schema";
import { getBalance } from "@/lib/billing/wallet";
import { priceFor } from "@/lib/billing/pricing";
import { resolveUserModel } from "@/lib/billing/metering";
import { resolveMarginPct } from "@/lib/env";
import {
  estimateActionCost,
  type CostEstimate,
  type PaidActionKind,
  type UiModelPrice,
} from "@/lib/billing/ui";

/** زمینه‌ی هزینه‌ی AIِ کاربر — برای نمایش در صفحه‌های کنشِ پولی. */
export interface UserAiCostContext {
  plan: Plan;
  balanceToman: number;
  /** آیا کاربر اجازه‌ی فراخوانیِ پولی دارد؟ (پلنِ free هرگز؛ payg/premium اگر موجودی>۰). */
  canUsePaidAi: boolean;
  /** قیمتِ مدلِ مؤثرِ کاربر (اگر کاتالوگ خالی/مدل ناشناخته بود null). */
  price: UiModelPrice | null;
  /** درصدِ حاشیه‌ی فعال. */
  marginPct: number;
}

/** پلنِ کاربر را می‌خواند (پیش‌فرضِ محتاطانه free اگر یافت نشد). */
async function readPlan(userId: string): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.plan ?? "free";
}

/**
 * زمینه‌ی هزینه‌ی AIِ کاربر را می‌سازد. هرگز throw نمی‌کند بابتِ نبودِ مدل/کاتالوگ —
 * در آن صورت price=null می‌شود و تخمین حذف می‌شود (کنش همچنان کار می‌کند).
 */
export async function getUserAiCostContext(
  userId: string,
): Promise<UserAiCostContext> {
  const marginPct = resolveMarginPct();

  const [plan, balanceToman] = await Promise.all([
    readPlan(userId),
    getBalance(userId).catch(() => 0),
  ]);

  let price: UiModelPrice | null = null;
  try {
    const { modelId } = await resolveUserModel(userId, undefined, db);
    const p = await priceFor(modelId, db);
    price = {
      modelId: p.modelId,
      inputPer1kToman: p.inputPer1kToman,
      outputPer1kToman: p.outputPer1kToman,
    };
  } catch {
    // کاتالوگ خالی/مدل ناشناخته → بدونِ تخمین (UI آن را حذف می‌کند).
    price = null;
  }

  const canUsePaidAi = plan !== "free" && balanceToman > 0;

  return { plan, balanceToman, canUsePaidAi, price, marginPct };
}

/**
 * تخمینِ هزینه‌ی یک کنشِ پولی را از زمینه می‌سازد (یا null اگر قیمت معلوم نیست).
 * یک پوششِ راحت تا صفحه‌ها مستقیماً CostEstimate بگیرند.
 */
export function actionEstimate(
  ctx: UserAiCostContext,
  action: PaidActionKind,
): CostEstimate | null {
  if (!ctx.price) return null;
  return estimateActionCost(action, ctx.price, ctx.marginPct);
}
