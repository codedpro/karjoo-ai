import "server-only";

/**
 * سهمیه‌ی اپلای روزانه (server-only) — WF3 بخش D.
 *
 * قاعده: کاربرِ پلنِ Free حداکثر ۱۰۰ اپلای در روز دارد (شمارشِ اپلای‌های امروزِ همان
 * کاربر). پلن‌های پولی سقف ندارند (applyQuotaPerDay = null در plans.ts). این گارد در
 * نقطه‌ی *ثبتِ یک اپلای* اعمال می‌شود (مسیرِ نتیجه‌ی صفِ اپلای) تا یک کاربر نتواند با
 * چند اجرا از سقف عبور کند.
 *
 * مبنای شمارش: ردیف‌های applications که createdAt آن‌ها امروز است (date_trunc('day',
 * now()) سمتِ DB). createdAt تغییرناپذیر است؛ پس re-scoreها شمارش را خراب نمی‌کنند.
 *
 * db/خواننده تزریق‌پذیرند تا تستِ بدونِ DB ممکن باشد.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { applications, type Plan } from "@/db/schema";
import { applyQuotaFor } from "@/lib/billing/plans";
import { ApplyQuotaError } from "@/lib/billing/errors";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد (شمارشِ اپلای‌های امروز). */
export type ApplyQuotaDb = Pick<typeof defaultDb, "select">;

/**
 * تعدادِ اپلای‌هایی که امروز (از نیمه‌شبِ سرور) برای این کاربر ثبت شده را برمی‌گرداند.
 * مرزِ روز سمتِ DB با date_trunc('day', now()) حساب می‌شود تا منطقه‌ی زمانیِ اپ یکنواخت بماند.
 */
export async function countAppliesToday(
  userId: string,
  db: ApplyQuotaDb = defaultDb,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        gte(applications.createdAt, sql`date_trunc('day', now())`),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** وابستگی‌های قابلِ تزریقِ گاردِ سهمیه — برای تستِ بدونِ DB. */
export interface ApplyQuotaDeps {
  db?: ApplyQuotaDb;
  /** خواننده‌ی شمارشِ امروز (پیش‌فرض countAppliesToday). */
  readCountToday?: (userId: string) => Promise<number>;
}

/** نتیجه‌ی موفقِ گارد — سقف، تعدادِ مصرف‌شده و باقی‌مانده (برای UI/لاگ). */
export interface ApplyQuotaStatus {
  /** سقفِ روزانه — null برای پلن‌های نامحدود. */
  limit: number | null;
  usedToday: number;
  /** باقی‌مانده — null اگر نامحدود. */
  remaining: number | null;
}

/**
 * تأیید می‌کند کاربر هنوز در سهمیه‌ی اپلای امروز جا دارد، وگرنه `ApplyQuotaError`
 * (typed) پرتاب می‌کند. پلن‌های نامحدود (applyQuotaPerDay = null) همیشه عبور می‌کنند و
 * هیچ کوئریِ شمارشی نمی‌زنند (مسیرِ ارزان برای کاربرانِ پولی).
 *
 * @param userId کاربری که اپلای برایش ثبت می‌شود.
 * @param plan   پلنِ کاربر (از users.plan) — سقف از plans.ts گرفته می‌شود.
 * @returns وضعیتِ سهمیه در صورتِ مجاز بودن.
 */
export async function assertApplyQuota(
  userId: string,
  plan: Plan,
  deps: ApplyQuotaDeps = {},
): Promise<ApplyQuotaStatus> {
  const limit = applyQuotaFor(plan);
  // پلنِ نامحدود → بدونِ شمارش، بدونِ سقف.
  if (limit === null) {
    return { limit: null, usedToday: 0, remaining: null };
  }

  const db = deps.db ?? defaultDb;
  const readCount =
    deps.readCountToday ?? ((id: string) => countAppliesToday(id, db));
  const usedToday = await readCount(userId);

  if (usedToday >= limit) {
    throw new ApplyQuotaError({ usedToday, limit });
  }
  return { limit, usedToday, remaining: limit - usedToday };
}
