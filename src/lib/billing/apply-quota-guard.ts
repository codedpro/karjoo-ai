import "server-only";

/**
 * گاردِ سهمیه‌ی اپلای «به‌ازای userId» (WF3 Track B) — یک wrapperِ نازک روی
 * Foundation#assertApplyQuota که پلنِ کاربر را *از روی نشست/DB* می‌خواند.
 *
 * چرا این لایه؟ نقطه‌ی ثبتِ اپلای (مسیرِ نتیجه‌ی صفِ افزونه) فقط `userId` احرازشده را
 * دارد، نه پلن را. assertApplyQuota پلن را به‌عنوان ورودی می‌خواهد (تا سقف از plans.ts
 * گرفته شود). این تابع پلنِ کاربر را امن می‌خواند (پیش‌فرضِ محتاطانه free) و گارد را
 * اعمال می‌کند. هیچ فایلِ مالکیتیِ Foundation را ویرایش نمی‌کند؛ صرفاً مصرف‌کننده است.
 *
 * مالکیت/قاعده‌ی ۴: کاربر همیشه از نشست می‌آید (نه از بدنه)؛ این تابع فقط با همان
 * userId کار می‌کند و سقف را برای *همان* کاربر می‌سنجد.
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند تا بدونِ DB تست شود.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users, type Plan } from "@/db/schema";
import {
  assertApplyQuota,
  type ApplyQuotaDeps,
  type ApplyQuotaStatus,
} from "@/lib/billing/apply-quota";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد — خواندنِ پلنِ کاربر. */
export type PlanReadDb = Pick<typeof defaultDb, "select">;

/** وابستگی‌های قابلِ تزریقِ گارد — برای تستِ بدونِ DB. */
export interface ApplyQuotaGuardDeps extends ApplyQuotaDeps {
  /** خواننده‌ی پلنِ کاربر (پیش‌فرض از جدولِ users؛ نبودِ ردیف → free). */
  readPlan?: (userId: string) => Promise<Plan>;
}

/** پلنِ خامِ کاربر را از جدولِ users می‌خواند (پیش‌فرضِ محتاطانه free). */
export async function readUserPlan(
  userId: string,
  db: PlanReadDb = defaultDb,
): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.plan ?? "free";
}

/**
 * سهمیه‌ی اپلای روزانه‌ی این کاربر را تأیید می‌کند (با خواندنِ پلن از DB)، وگرنه
 * `ApplyQuotaError` (typed) پرتاب می‌کند. این را *پیش از* ثبتِ یک اپلایِ تازه صدا بزنید.
 *
 * پلن‌های نامحدود (pro/max/maxplus) همیشه عبور می‌کنند و هیچ کوئریِ شمارشی نمی‌زنند
 * (assertApplyQuota مسیرِ ارزان را می‌گیرد). فقط free با ۱۰۰/روز محدود است.
 *
 * @returns وضعیتِ سهمیه (سقف/مصرف/باقی‌مانده) در صورتِ مجاز بودن.
 */
export async function assertApplyQuotaForUser(
  userId: string,
  deps: ApplyQuotaGuardDeps = {},
): Promise<ApplyQuotaStatus> {
  const db = deps.db ?? defaultDb;
  const readPlan = deps.readPlan ?? ((id: string) => readUserPlan(id, db));
  const plan = await readPlan(userId);
  return assertApplyQuota(userId, plan, deps);
}
