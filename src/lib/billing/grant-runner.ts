import "server-only";

/**
 * اجراگرِ گرنتِ ماهانه (server-only) — WF3 تراکِ C، هسته‌ی مشترکِ مسیرِ داخلی و اسکریپت.
 *
 * هم مسیرِ POST /api/internal/grant-credits و هم اسکریپتِ src/scripts/grant-monthly.ts
 * این تابع را صدا می‌زنند تا منطقِ «حلقه روی کاربران → گرنتِ ایدمپوتنتِ Foundation» در
 * یک‌جا بماند. خودِ گرنت (grantMonthlyCredits) مالکِ Foundation است و دست‌نخورده می‌ماند؛
 * اینجا فقط *انتخابِ کاربران* و *جمع‌بندیِ نتیجه* اضافه می‌شود.
 *
 * ایدمپوتنسی: grantMonthlyCredits به‌ازای (کاربر، ماه) ایدمپوتنت است (refIdِ یکتای
 * grant:<userId>:<period> در دفترِ کیف‌پول). پس دو اجرا در همان ماه = بدونِ گرنتِ دوباره.
 *
 * انتخابِ کاربران: فقط کاربرانِ *فعالِ* پلنِ پولی (monthlyCreditToman > ۰) را برمی‌گزینیم
 * تا روی کاربرانِ Free بیهوده کوئری/گرنت نخوریم (گرنتِ Free هرحال granted=false است).
 *
 * db/خواننده/گرنت تزریق‌پذیرند تا تستِ بدونِ DB ممکن باشد.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users, type Plan } from "@/db/schema";
import {
  grantMonthlyCredits,
  type GrantsDb,
  type GrantResult,
} from "@/lib/billing/grants";
import { monthlyCreditFor } from "@/lib/billing/plans";
import { periodMonthOf } from "@/lib/billing/ai-budget";

/** یک کاربرِ نامزدِ گرنت — شناسه + پلنِ فعلی. */
export interface GrantCandidate {
  id: string;
  plan: Plan;
}

/**
 * هندلِ DB که این لایه نیاز دارد — همان هندلِ کاملِ Drizzle: هم برای select (انتخابِ
 * کاربران) و هم برای پاس‌دادن به grantMonthlyCredits (که transaction می‌خواهد).
 */
export type GrantRunnerDb = GrantsDb;

/** خلاصه‌ی نتیجه‌ی یک اجرای گرنتِ ماهانه. */
export interface GrantRunSummary {
  /** ماهِ هدف (YYYY-MM، UTC). */
  period: string;
  /** تعدادِ کاربرِ بررسی‌شده. */
  scanned: number;
  /** تعدادِ گرنتِ تازه‌ی داده‌شده (granted=true). */
  granted: number;
  /** تعدادِ ردشده (قبلاً این ماه گرنت گرفته‌اند). */
  skipped: number;
  /** تعدادِ بی‌اعتبار (پلنِ Free/legacy — گرنت ندارند). */
  ineligible: number;
  /** جمعِ کلِ اعتبارِ تازه‌ی credit‌شده به تومان. */
  totalGrantedToman: number;
  /** تعدادِ خطا حینِ گرنتِ تک‌تکِ کاربران (اجرا متوقف نمی‌شود). */
  errors: number;
}

/** وابستگی‌های قابلِ تزریقِ اجراگر — برای تستِ بدونِ DB. */
export interface GrantRunnerDeps {
  db?: GrantRunnerDb;
  /**
   * فهرستِ کاربرانِ هدف. اگر داده شود، انتخابِ DB رد می‌شود (برای تست/هدف‌مند).
   * اگر داده نشود، listEligibleUsers از DB خوانده می‌شود.
   */
  candidates?: GrantCandidate[];
  /** خواننده‌ی کاربرانِ واجدِ شرایط (پیش‌فرض listEligibleUsers). تزریقی برای تست. */
  listCandidates?: (userIds?: string[]) => Promise<GrantCandidate[]>;
  /** گرنتِ تک‌کاربر (پیش‌فرض grantMonthlyCredits). تزریقی برای تست. */
  grant?: (
    userId: string,
    plan: Plan,
    now: number,
  ) => Promise<GrantResult>;
}

/** پارامترهای یک اجرا. */
export interface GrantRunOptions {
  /** فقط همین کاربران را گرنت کن. اگر داده نشود، همه‌ی واجدینِ شرایط. */
  userIds?: string[];
  /** زمانِ مرجع برای تعیینِ ماه (تزریقی برای تست/کرانِ تاریخی). */
  now?: number;
}

/**
 * کاربرانِ واجدِ شرایطِ گرنت را از DB برمی‌گرداند: فعال (is_active) و پلنِ پولی
 * (monthlyCreditToman > ۰ → pro/max/maxplus). اگر userIds داده شود، فقط همان‌ها (که
 * هم فعال و هم پلن‌دار باشند). کاربرانِ Free/legacy عمداً انتخاب نمی‌شوند.
 */
export async function listEligibleUsers(
  db: GrantRunnerDb = defaultDb,
  userIds?: string[],
): Promise<GrantCandidate[]> {
  // پلن‌های واجدِ شرایط = آن‌هایی که اعتبارِ ماهانه دارند (از plans.ts مشتق می‌شود).
  const paidPlans: Plan[] = (["free", "payg", "premium", "pro", "max", "maxplus"] as Plan[]).filter(
    (p) => monthlyCreditFor(p) > 0,
  );
  if (paidPlans.length === 0) return [];

  const targeted = userIds && userIds.length > 0;
  const rows = await db
    .select({ id: users.id, plan: users.plan })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        inArray(users.plan, paidPlans),
        ...(targeted ? [inArray(users.id, userIds!)] : []),
      ),
    );

  return rows.map((r) => ({ id: r.id, plan: r.plan }));
}

/**
 * یک اجرای گرنتِ ماهانه را انجام می‌دهد: کاربرانِ واجدِ شرایط را برمی‌گزیند و برای هرکدام
 * grantMonthlyCredits (ایدمپوتنت) را صدا می‌زند، سپس خلاصه برمی‌گرداند. خطای یک کاربر
 * اجرا را متوقف نمی‌کند (errors شمرده می‌شود) تا یک ردیفِ بد همه را قفل نکند.
 */
export async function runMonthlyGrants(
  opts: GrantRunOptions = {},
  deps: GrantRunnerDeps = {},
): Promise<GrantRunSummary> {
  const now = opts.now ?? Date.now();
  const db = deps.db ?? defaultDb;

  const listCandidates =
    deps.listCandidates ?? ((ids?: string[]) => listEligibleUsers(db, ids));
  const grant =
    deps.grant ??
    ((userId: string, plan: Plan, t: number) =>
      grantMonthlyCredits(userId, { db, plan }, t));

  const candidates =
    deps.candidates ?? (await listCandidates(opts.userIds));

  const summary: GrantRunSummary = {
    period: periodMonthOf(now),
    scanned: 0,
    granted: 0,
    skipped: 0,
    ineligible: 0,
    totalGrantedToman: 0,
    errors: 0,
  };

  for (const c of candidates) {
    summary.scanned += 1;
    try {
      const res = await grant(c.id, c.plan, now);
      if (res.granted) {
        summary.granted += 1;
        summary.totalGrantedToman += res.amount;
      } else if (res.amount === 0 && monthlyCreditFor(c.plan) > 0) {
        // پلنِ پولی ولی granted=false ⇒ قبلاً این ماه گرنت گرفته (ایدمپوتنسی).
        summary.skipped += 1;
      } else {
        // پلنِ بی‌اعتبار (Free/legacy) — گرنت ندارد.
        summary.ineligible += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[grant-runner] گرنتِ کاربر ${c.id} ناموفق بود:`, err);
    }
  }

  return summary;
}
