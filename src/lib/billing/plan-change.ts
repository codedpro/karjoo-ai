import "server-only";

/**
 * اثرهای جانبیِ تغییرِ پلن (server-only) — WF3 تراکِ C.
 *
 * این ماژول «نازک» است و هیچ منطقِ مالکِ Foundation را بازنویسی نمی‌کند: فقط ابزارهای
 * موجود را *ترکیب* می‌کند تا یک نقطه‌ی واحد برای «وقتی پلنِ کاربر تغییر/ارتقا یافت چه
 * باید بشود» داشته باشیم:
 *
 *   ۱) گرنتِ اعتبارِ ماهانه‌ی پلنِ جدید — با grantMonthlyCredits (مالکِ Foundation).
 *      *ایدمپوتنت* است (به‌ازای کاربر و ماه)، پس ارتقا در همان ماه دوبار اعتبار نمی‌دهد و
 *      با اجرای کرانِ ماهانه هم تداخل نمی‌کند.
 *   ۲) یادداشت‌های اثرِ پلن (سهمیه‌ی اپلای، سقفِ IPِ ورکر) — صرفاً *مشتق‌شده* از plans.ts
 *      برای نمایش/لاگ. سهمیه‌ی اپلای «وضعیت» نیست که reset شود؛ شمارشِ روزانه از
 *      createdAtِ applications مشتق می‌شود (apply-quota.ts)، پس صرفِ تغییرِ پلن، سقفِ
 *      جدید را بلافاصله و بدونِ هیچ نوشتنی اعمال می‌کند. این یادداشت‌ها برای شفافیت‌اند.
 *
 * چرا اینجا و نه در Foundation؟ grantMonthlyCredits و plans.ts منبعِ حقیقت‌اند و مالکِ
 * Foundation؛ این فایل فقط آن‌ها را به یک «اکشنِ تغییرِ پلن» می‌چسباند (ترکیب، نه منطقِ نو).
 *
 * db تزریق‌پذیر است (از طریقِ GrantDeps) تا تستِ بدونِ DB ممکن باشد.
 */
import type { Plan } from "@/db/schema";
import {
  grantMonthlyCredits,
  type GrantDeps,
  type GrantResult,
} from "@/lib/billing/grants";
import { applyQuotaFor, planFor, workerIpLimitFor } from "@/lib/billing/plans";

/** یادداشت‌های مشتق‌شده‌ی اثرِ پلنِ جدید — برای نمایش/لاگ، نه «وضعیتِ» نوشتنی. */
export interface PlanEffectNotes {
  /** کلیدِ پلنِ نرمال‌شده (payg/premium ⇒ free/pro). */
  planLabelFa: string;
  /** سقفِ اپلای روزانه — null برای نامحدود (پلن‌های پولی). */
  applyQuotaPerDay: number | null;
  /** سقفِ IPِ ورکرِ auto-apply (free/pro=۰، max=۱، maxplus=۵). */
  workerIpLimit: number;
  /** آیا «تماسِ مستقیم» دارد. */
  directContact: boolean;
}

/** نتیجه‌ی اعمالِ اثرهای تغییرِ پلن — گرنت + یادداشت‌های مشتق. */
export interface PlanChangeResult {
  /** نتیجه‌ی گرنتِ ماهانه (granted=false اگر این ماه قبلاً داده شده/پلنِ بی‌اعتبار). */
  grant: GrantResult;
  /** یادداشت‌های اثرِ پلنِ جدید (مشتق از plans.ts). */
  notes: PlanEffectNotes;
}

/** یادداشت‌های اثرِ یک پلن را از plans.ts مشتق می‌کند (خالص، بدونِ I/O). */
export function planEffectNotes(plan: Plan | string): PlanEffectNotes {
  const def = planFor(plan);
  return {
    planLabelFa: def.labelFa,
    applyQuotaPerDay: applyQuotaFor(plan),
    workerIpLimit: workerIpLimitFor(plan),
    directContact: def.directContact,
  };
}

/**
 * اثرهای جانبیِ تغییرِ پلن را اعمال می‌کند: گرنتِ ایدمپوتنتِ اعتبارِ ماهانه + یادداشت‌های
 * مشتق. این را روی *ارتقا* (و هر تغییرِ پلن) صدا بزنید — همان مسیرِ کرانِ ماهانه است،
 * پس فراخوانیِ دوباره در همان ماه بی‌خطر (no double-grant) است.
 *
 * نکته‌ی مهم: این تابع پلنِ کاربر را در users *نمی‌نویسد*؛ نوشتنِ پلن مسئولیتِ مسیرِ
 * ارتقا/پرداخت است. اینجا فقط اثرهای پسینِ تغییر (گرنت + یادداشت) اعمال می‌شود — و چون
 * grantMonthlyCredits می‌تواند پلن را تزریقی بگیرد، می‌توان آن را پیش/پس از نوشتنِ پلن
 * صدا زد (پلنِ هدف را صریحاً پاس بدهید تا از حالتِ مسابقه با نوشتنِ users جلوگیری شود).
 *
 * @param userId کاربرِ هدف.
 * @param newPlan پلنِ هدف (پلنِ جدید). به grantMonthlyCredits تزریق می‌شود تا مبلغِ گرنت
 *               از همین پلنِ صریح مشتق شود، نه از خواندنِ احتمالاً-قدیمیِ users.plan.
 * @param deps   وابستگی‌های قابلِ تزریقِ گرنت (db/store) — برای تستِ بدونِ DB.
 * @param now    زمانِ مرجع برای تعیینِ ماهِ گرنت (تزریقی برای تست/کرانِ تاریخی).
 */
export async function applyPlanChange(
  userId: string,
  newPlan: Plan,
  deps: GrantDeps = {},
  now: number = Date.now(),
): Promise<PlanChangeResult> {
  // پلنِ هدف را صریح تزریق می‌کنیم تا گرنت از پلنِ جدید (نه users.plan قدیمی) مشتق شود.
  const grant = await grantMonthlyCredits(
    userId,
    { ...deps, plan: newPlan },
    now,
  );
  return { grant, notes: planEffectNotes(newPlan) };
}
