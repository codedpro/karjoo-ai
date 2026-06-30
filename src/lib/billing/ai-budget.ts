import "server-only";

/**
 * گاردریلِ بودجه‌ی سراسریِ هوش مصنوعی (server-only) — محافظِ هزینه‌ی واقعیِ بالادست.
 *
 * مدلِ کار (CONTEXT بخش A):
 *   • یک شمارنده‌ی ماهانه (app_ai_budget، یک ردیف به‌ازای هر 'YYYY-MM') جمعِ هزینه‌ی
 *     بالادستِ هوش مصنوعیِ کلِ اپ را نگه می‌دارد. این شمارنده داخلِ همان تراکنشِ تسویه‌ی
 *     metering با upstreamCostToman هر فراخوانی افزایش می‌یابد (نه اسکنِ کاملِ جدول).
 *   • وقتی جمعِ ماه ≥ سقف (aiMonthlyCapToman از env)، یا پرچمِ دستیِ app_settings روشن
 *     باشد → «حالتِ نگه‌داریِ هوش مصنوعی»: هر فراخوانیِ پولی بلاک می‌شود.
 *   • assertAiAvailable(db) داخلِ meter() *پیش از* فراخوانیِ گیت‌وی صدا زده می‌شود
 *     (کنارِ assertCanUsePaidAi). قابلیت‌های غیر-AI دست‌نخورده‌اند.
 *
 * همه‌ی توابع db/store تزریق‌پذیر دارند تا تستِ بدونِ DB ممکن باشد.
 */
import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { appAiBudget, appSettings } from "@/db/schema";
import { aiMonthlyCapToman } from "@/lib/env";
import { AiMaintenanceError } from "@/lib/billing/errors";

export { aiMonthlyCapToman };

/** هندلِ کاملِ Drizzle (برای خواندنِ بودجه/تنظیمات). */
export type BudgetDb = typeof defaultDb;

/**
 * هندلِ کمینه‌ای که incrementMonthUpstream لازم دارد — همان متدهایی که هم db و هم
 * یک تراکنشِ Drizzle (tx) دارند. این اجازه می‌دهد افزایشِ شمارنده *داخلِ* تراکنشِ
 * تسویه‌ی metering انجام شود (اتمیک با usage_record + debit).
 */
export type BudgetIncrementer = Pick<BudgetDb, "insert">;

/**
 * ماهِ تقویمیِ یک زمان را به قالبِ 'YYYY-MM' (UTC) برمی‌گرداند — کلیدِ ردیفِ بودجه.
 * UTC تا مرزِ ماه مستقل از منطقه‌ی زمانیِ سرور پایدار بماند.
 */
export function periodMonthOf(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * شمارنده‌ی هزینه‌ی بالادستِ ماهِ جاری را به‌صورتِ اتمیک افزایش می‌دهد (upsert).
 * این را *داخلِ* تراکنشِ تسویه‌ی metering با `tx` صدا بزنید تا با usage_record/debit
 * اتمیک بماند. مبلغِ ≤ ۰ نادیده گرفته می‌شود (no-op).
 *
 * @param amount هزینه‌ی بالادستِ این فراخوانی به تومان.
 * @param store  هندلِ db یا tx (هر چیزی با متدِ insert).
 * @param now    زمان (برای تعیینِ ماه) — تزریقی برای تست.
 */
export async function incrementMonthUpstream(
  amount: number,
  store: BudgetIncrementer = defaultDb,
  now: number = Date.now(),
): Promise<void> {
  if (!(amount > 0)) return;
  const period = periodMonthOf(now);
  const inc = Math.round(amount);

  await store
    .insert(appAiBudget)
    .values({
      periodMonth: period,
      upstreamCostToman: inc,
      updatedAt: new Date(now),
    })
    .onConflictDoUpdate({
      target: appAiBudget.periodMonth,
      set: {
        upstreamCostToman: sql`${appAiBudget.upstreamCostToman} + ${inc}`,
        updatedAt: new Date(now),
      },
    });
}

/**
 * جمعِ هزینه‌ی بالادستِ هوش مصنوعیِ ماهِ جاری را از شمارنده می‌خواند (۰ اگر ردیفی نباشد).
 */
export async function currentMonthUpstreamToman(
  db: BudgetDb = defaultDb,
  now: number = Date.now(),
): Promise<number> {
  const period = periodMonthOf(now);
  const [row] = await db
    .select({ total: appAiBudget.upstreamCostToman })
    .from(appAiBudget)
    .where(eq(appAiBudget.periodMonth, period))
    .limit(1);
  return row?.total ?? 0;
}

/** آیا پرچمِ دستیِ نگه‌داری (app_settings.aiMaintenanceManual) روشن است؟ */
export async function isManualMaintenance(db: BudgetDb = defaultDb): Promise<boolean> {
  const [row] = await db
    .select({ manual: appSettings.aiMaintenanceManual })
    .from(appSettings)
    .where(eq(appSettings.key, "global"))
    .limit(1);
  return row?.manual ?? false;
}

/**
 * پرچمِ دستیِ نگه‌داری را روشن/خاموش می‌کند (upsert روی ردیفِ singletonِ 'global').
 * برای کنترلِ ادمین/اسکریپت — برای force روشن یا خاموش‌کردنِ سرویس.
 */
export async function setManualMaintenance(
  on: boolean,
  db: BudgetDb = defaultDb,
  now: number = Date.now(),
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "global", aiMaintenanceManual: on, updatedAt: new Date(now) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { aiMaintenanceManual: on, updatedAt: new Date(now) },
    });
}

/** نتیجه‌ی بررسیِ حالتِ نگه‌داری — برای لاگ/داشبورد. */
export interface MaintenanceStatus {
  inMaintenance: boolean;
  /** آیا به‌خاطرِ پرچمِ دستی است؟ */
  manual: boolean;
  /** آیا به‌خاطرِ رسیدن به سقفِ بودجه است؟ */
  capReached: boolean;
  monthUpstreamToman: number;
  capToman: number;
  period: string;
}

/**
 * وضعیتِ کاملِ حالتِ نگه‌داری را برمی‌گرداند: نگه‌داری اگر پرچمِ دستی روشن باشد *یا*
 * جمعِ ماه ≥ سقف. (یک کوئریِ بودجه + یک کوئریِ تنظیمات.)
 *
 * capToman اختیاری است (پیش‌فرض از env)؛ تزریقِ آن در تست، نتیجه را بدونِ وابستگی به
 * env قطعی می‌کند (env یک‌بار در بوت snapshot می‌شود و در تست قابلِ stub نیست).
 */
export async function maintenanceStatus(
  db: BudgetDb = defaultDb,
  now: number = Date.now(),
  capToman: number = aiMonthlyCapToman(),
): Promise<MaintenanceStatus> {
  const [manual, monthUpstreamToman] = await Promise.all([
    isManualMaintenance(db),
    currentMonthUpstreamToman(db, now),
  ]);
  // سقفِ ۰ یا منفی را «بدونِ سقف» می‌گیریم تا یک پیکربندیِ اشتباه سرویس را قفل نکند.
  const capReached = capToman > 0 && monthUpstreamToman >= capToman;
  return {
    inMaintenance: manual || capReached,
    manual,
    capReached,
    monthUpstreamToman,
    capToman,
    period: periodMonthOf(now),
  };
}

/** آیا هوش مصنوعی در حالتِ نگه‌داری است؟ (سقفِ بودجه رسیده یا پرچمِ دستی روشن). */
export async function isAiInMaintenance(
  db: BudgetDb = defaultDb,
  now: number = Date.now(),
  capToman: number = aiMonthlyCapToman(),
): Promise<boolean> {
  return (await maintenanceStatus(db, now, capToman)).inMaintenance;
}

/**
 * تأیید می‌کند سرویسِ هوش مصنوعی در دسترس است، وگرنه `AiMaintenanceError` (typed)
 * پرتاب می‌کند. این را *پیش از* فراخوانیِ گیت‌وی صدا بزنید (داخلِ meter).
 */
export async function assertAiAvailable(
  db: BudgetDb = defaultDb,
  now: number = Date.now(),
  capToman: number = aiMonthlyCapToman(),
): Promise<void> {
  const status = await maintenanceStatus(db, now, capToman);
  if (status.inMaintenance) {
    throw new AiMaintenanceError({ manual: status.manual });
  }
}
