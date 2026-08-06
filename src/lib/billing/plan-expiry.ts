import "server-only";

/**
 * انقضای پلن — کاربرانی که دوره‌ی پرداختی‌شان تمام شده به `free` برمی‌گردند.
 *
 * چرا وجود دارد: پلن‌ها «ماهانه» قیمت‌گذاری و فروخته می‌شوند، ولی هیچ انقضا، تمدید یا
 * پایین‌آوردنِ خودکاری وجود نداشت — یک پرداختِ ۲۹۹٬۰۰۰ تومانی یعنی Pro تا ابد، و یک
 * پرداختِ ۱٬۹۹۰٬۰۰۰ تومانی یعنی Max+ (با ۵ IPِ ورکر) تا ابد. نشتِ مستقیمِ درآمد.
 *
 * قواعدِ ایمنی:
 *   • فقط کاربرانی که `plan_expires_at` **دارند** و از آن گذشته‌اند لمس می‌شوند.
 *     `null` = بی‌انقضا و دست‌نخورده باقی می‌ماند — یعنی کاربرانِ پیش از افزودنِ این ستون
 *     هرگز به‌خاطرِ داده‌ی تاریخی downgrade نمی‌شوند (سازگاریِ عقب‌رو، fail-safe).
 *   • فقط پلنِ **پولی** پایین می‌آید؛ `free` اصلاً هدف نیست.
 *   • مهلتِ ارفاق (grace) پیش از پایین‌آوردن اعمال می‌شود تا یک تمدیدِ چند ساعت دیرتر،
 *     کاربر را وسطِ کار قطع نکند.
 *   • هیچ پولی جابه‌جا نمی‌شود — این فقط استحقاق را با واقعیت هم‌تراز می‌کند.
 *
 * تخصیص‌های ناوگان عمداً حذف نمی‌شوند: دوباره‌خرید باید فوراً کار کند، و
 * `claimFleetJobs`/گیت‌های سطحِ سرور خودشان پلنِ فعلی را می‌بینند.
 */
import { and, eq, isNotNull, lt, ne, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users } from "@/db/schema";

export type PlanExpiryDb = typeof defaultDb;

/** مهلتِ ارفاق پس از پایانِ دوره، پیش از پایین‌آوردنِ پلن. */
export const PLAN_GRACE_HOURS = 48;

export interface ExpirePlansResult {
  /** تعدادِ کاربرانی که به free برگردانده شدند. */
  downgraded: number;
  /** شناسه‌ی کاربرانِ متأثر (برای لاگ/ممیزی — بدونِ داده‌ی شخصی). */
  userIds: string[];
}

/**
 * همه‌ی پلن‌های پولیِ گذشته از مهلت را به `free` برمی‌گرداند.
 *
 * ایدمپوتنت: اجرای دوباره چیزی برای انجام پیدا نمی‌کند (چون `plan` دیگر free است و
 * `plan_expires_at` پاک شده).
 */
export async function expireLapsedPlans(
  conn: PlanExpiryDb = defaultDb,
  now: Date = new Date(),
): Promise<ExpirePlansResult> {
  const cutoff = new Date(now.getTime() - PLAN_GRACE_HOURS * 60 * 60 * 1000);

  const rows = await conn
    .update(users)
    .set({ plan: "free", planExpiresAt: null, updatedAt: now })
    .where(
      and(
        ne(users.plan, "free"),
        isNotNull(users.planExpiresAt),
        lt(users.planExpiresAt, cutoff),
      ),
    )
    .returning({ id: users.id });

  return { downgraded: rows.length, userIds: rows.map((r) => r.id) };
}

/**
 * پلن‌هایی که به‌زودی منقضی می‌شوند (برای یادآوریِ تمدید). فقط خواندنی.
 * @param withinHours بازه‌ی آینده‌نگر (پیش‌فرض ۷۲ ساعت).
 */
export async function listExpiringSoon(
  withinHours = 72,
  conn: PlanExpiryDb = defaultDb,
  now: Date = new Date(),
): Promise<{ id: string; plan: string; planExpiresAt: Date | null }[]> {
  const until = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
  return conn
    .select({ id: users.id, plan: users.plan, planExpiresAt: users.planExpiresAt })
    .from(users)
    .where(
      and(
        ne(users.plan, "free"),
        isNotNull(users.planExpiresAt),
        lt(users.planExpiresAt, until),
        sql`${users.planExpiresAt} >= ${now}`,
      ),
    );
}
