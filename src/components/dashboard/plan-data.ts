import "server-only";

/**
 * خواندنِ «وضعیتِ پلنِ کاربر» برای داشبورد و مسیرِ `GET /api/me/plan` (server-side).
 *
 * یک منبعِ مشترکِ فقط-خواندنی است تا هم RSCِ صفحه‌ی پلن‌ها و هم route handler یکسان
 * عمل کنند و قاعده‌ی ۴ (دادهٔ هر کاربر فقط برای همان کاربر) یک‌جا رعایت شود. این لایه:
 *   • پلنِ فعلیِ کاربر را از جدولِ users می‌خواند،
 *   • موجودیِ کیف‌پول را از هسته‌ی بیلینگِ Foundation (`getBalance`) می‌گیرد،
 *   • وضعیتِ گرنتِ ماهِ جاری را *بدونِ نوشتن* بررسی می‌کند (آیا ردیفِ گرنتِ این ماه هست؟)،
 *   • و تعدادِ اپلای‌های امروز را نسبت به سهمیه‌ی پلن می‌سنجد (Free=۱۰۰، بقیه نامحدود).
 *
 * هیچ debit/credit/گرنتی اینجا انجام نمی‌شود؛ صرفاً نمایش. نوشتنِ گرنت فقط در مسیرِ
 * POST (هنگامِ ارتقا) از طریقِ grantMonthlyCredits رخ می‌دهد.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, walletLedger, type Plan } from "@/db/schema";
import { getBalance } from "@/lib/billing/wallet";
import { countAppliesToday } from "@/lib/billing/apply-quota";
import { periodMonthOf } from "@/lib/billing/ai-budget";
import { grantRefId } from "@/lib/billing/grants";
import {
  applyQuotaFor,
  monthlyCreditFor,
  normalizePlanKey,
  planFor,
  type PlanKey,
} from "@/lib/billing/plans";

/** وضعیتِ گرنتِ ماهِ جاریِ کاربر (بدونِ نوشتن). */
export interface MonthlyGrantStatus {
  /** ماهِ هدف (YYYY-MM). */
  period: string;
  /** آیا گرنتِ این ماه قبلاً اعمال شده؟ */
  granted: boolean;
  /** مبلغِ اعتبارِ ماهانه‌ی پلن به تومان (۰ برای Free). */
  amountToman: number;
}

/** وضعیتِ سهمیه‌ی اپلای امروزِ کاربر. */
export interface ApplyUsageStatus {
  /** سقفِ روزانه — null برای پلن‌های نامحدود. */
  limit: number | null;
  usedToday: number;
  /** باقی‌مانده — null اگر نامحدود. */
  remaining: number | null;
}

/** وضعیتِ کاملِ پلنِ کاربر — مصرفِ مشترکِ route و داشبورد. */
export interface UserPlanStatus {
  /** کلیدِ پلنِ فعالِ نرمال‌شده (payg→free، premium→pro). */
  planKey: PlanKey;
  /** مقدارِ خامِ users.plan (برای سازگاری/لاگ). */
  rawPlan: Plan;
  balanceToman: number;
  grant: MonthlyGrantStatus;
  apply: ApplyUsageStatus;
}

/** پلنِ خامِ کاربر را از جدولِ users می‌خواند (پیش‌فرضِ محتاطانه free). */
async function readRawPlan(userId: string): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.plan ?? "free";
}

/**
 * آیا گرنتِ ماهِ مشخص برای این کاربر قبلاً ثبت شده؟ همان شرطِ ایدمپوتنسیِ grants.ts
 * (kind='grant' + refId=`grant:<userId>:<period>`) را *فقط می‌خواند* (بدونِ نوشتن).
 */
async function readGrantApplied(
  userId: string,
  period: string,
): Promise<boolean> {
  const refId = grantRefId(userId, period);
  const [row] = await db
    .select({ id: walletLedger.id })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.userId, userId),
        eq(walletLedger.kind, "grant"),
        eq(walletLedger.refId, refId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * وضعیتِ کاملِ پلنِ کاربر را می‌سازد: پلن، موجودی، وضعیتِ گرنتِ ماهِ جاری و سهمیه‌ی
 * اپلای امروز. مقید به userId (قاعده‌ی ۴). هیچ چیزی نمی‌نویسد.
 *
 * @param now زمانِ مرجع برای تعیینِ ماه — تزریقی برای تستِ قطعی.
 */
export async function getUserPlanStatus(
  userId: string,
  now: number = Date.now(),
): Promise<UserPlanStatus> {
  const rawPlan = await readRawPlan(userId);
  const planKey = normalizePlanKey(rawPlan);
  const period = periodMonthOf(now);
  const limit = applyQuotaFor(planKey);

  // موجودی، وضعیتِ گرنت و (در صورتِ سهمیه‌دار بودن) شمارشِ اپلای را موازی می‌خوانیم.
  const [balanceToman, grantApplied, usedToday] = await Promise.all([
    getBalance(userId).catch(() => 0),
    readGrantApplied(userId, period),
    limit === null ? Promise.resolve(0) : countAppliesToday(userId),
  ]);

  return {
    planKey,
    rawPlan,
    balanceToman,
    grant: {
      period,
      granted: grantApplied,
      amountToman: monthlyCreditFor(planKey),
    },
    apply: {
      limit,
      usedToday: limit === null ? 0 : usedToday,
      remaining: limit === null ? null : Math.max(0, limit - usedToday),
    },
  };
}

/** تعریفِ پلنِ فعلیِ کاربر (برای نمایش — برچسب/قیمت/قابلیت‌ها). */
export function currentPlanDefinition(status: UserPlanStatus) {
  return planFor(status.planKey);
}
