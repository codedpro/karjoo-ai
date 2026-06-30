import "server-only";

/**
 * گرنتِ اعتبارِ ماهانه‌ی هوش مصنوعی (server-only) — WF3 بخش E.
 *
 * هر پلنِ پولی یک اعتبارِ ماهانه دارد (monthlyCreditToman در plans.ts) که به کیف‌پولِ
 * کاربر credit می‌شود. این گرنت باید *ایدمپوتنت به‌ازای (کاربر، ماه)* باشد تا اجرای
 * مکرر (ارتقا + کرانِ ماهانه) دوبار اعتبار ندهد.
 *
 * مکانیزمِ ایدمپوتنسی (race-safe، DB-backed): یک ردیفِ دفترِ 'grant' با refType='grant'
 * و refId=`grant:<userId>:<YYYY-MM>`. یکتایی توسطِ یک ایندکسِ *partial unique* روی
 * (user_id, ref_id) WHERE kind='grant' تضمین می‌شود (wallet_ledger_grant_ref_uq،
 * migration 0006). در همان تراکنش: ابتدا کیف‌پول credit می‌شود، سپس درجِ ردیفِ دفتر با
 * onConflictDoNothing تلاش می‌شود — اگر برای این (کاربر، ماه) قبلاً ردیفی باشد، درج
 * ۰ ردیف برمی‌گرداند و کلِ تراکنش (شاملِ credit) با پرتابِ یک سنتینل rollback می‌شود
 * (granted=false). این، برخلافِ SELECT-then-INSERT، در برابرِ دو فراخوانیِ همزمان امن
 * است: تحتِ READ COMMITTED هم unique-violation/onConflict سریالایز می‌کند تا اعتبارِ
 * ماهانه هرگز دوبار داده نشود.
 *
 * db/store تزریق‌پذیرند تا تستِ بدونِ DB ممکن باشد.
 */
import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users, wallets, walletLedger, type Plan } from "@/db/schema";
import { monthlyCreditFor, normalizePlanKey } from "@/lib/billing/plans";
import { periodMonthOf } from "@/lib/billing/ai-budget";

/** هندلِ کاملِ Drizzle (به transaction نیاز است). */
export type GrantsDb = typeof defaultDb;

/** نتیجه‌ی یک تلاشِ گرنت — granted=false اگر قبلاً برای این ماه داده شده/پلنِ بی‌اعتبار. */
export interface GrantResult {
  granted: boolean;
  /** مبلغِ credit‌شده به تومان (۰ اگر granted=false). */
  amount: number;
  /** ماهِ هدف (YYYY-MM). */
  period: string;
  /** refId استفاده‌شده — برای لاگ/پیگیری. */
  refId: string;
}

/**
 * شناسه‌ی ارجاعِ ایدمپوتنسیِ گرنتِ یک کاربر در یک ماه. شکلِ پایدار: `grant:<userId>:<period>`.
 */
export function grantRefId(userId: string, period: string): string {
  return `grant:${userId}:${period}`;
}

/** درزِ پایداریِ گرنت — چکِ ایدمپوتنسی + credit، اتمیک. تزریقی برای تست. */
export interface GrantStore {
  /**
   * اگر برای این refId قبلاً گرنت ثبت نشده باشد، مبلغ را credit و یک ردیفِ دفترِ 'grant'
   * با همان refId می‌نویسد (اتمیک). اگر قبلاً ثبت شده، هیچ‌کاری نمی‌کند و already=true
   * برمی‌گرداند.
   */
  grantOnce(args: {
    userId: string;
    amount: number;
    refId: string;
    description: string;
    now: number;
  }): Promise<{ already: boolean }>;
}

/* ─────────────────────  پیاده‌سازیِ تولید (Drizzle, اتمیک)  ───────────────── */

/**
 * سنتینلِ داخلی: «گرنتِ این ماه قبلاً ثبت شده» — برای rollbackِ تراکنش هنگامِ
 * برخوردِ ایندکسِ یکتا. بیرون از این فایل دیده نمی‌شود؛ به { already: true } ترجمه می‌شود.
 */
const GRANT_ALREADY_EXISTS = Symbol("grant-already-exists");

/**
 * storeِ تولید: credit + درجِ ردیفِ دفتر، همه در یک تراکنش — race-safe.
 *
 * برخلافِ SELECT-then-INSERT (که تحتِ READ COMMITTED می‌توانست دوبار credit کند)،
 * این‌جا یکتاییِ گرنت را به DB می‌سپاریم: درجِ ردیفِ 'grant' با onConflictDoNothing روی
 * ایندکسِ partial (user_id, ref_id) WHERE kind='grant'. اگر درج ۰ ردیف برگرداند یعنی
 * گرنتِ این ماه قبلاً هست → با پرتابِ سنتینل کلِ تراکنش (شاملِ credit) rollback می‌شود.
 */
export function drizzleGrantStore(db: GrantsDb): GrantStore {
  return {
    async grantOnce(args) {
      try {
        await db.transaction(async (tx) => {
          // ۱) تضمینِ وجودِ کیف‌پول (idempotent).
          await tx
            .insert(wallets)
            .values({ userId: args.userId })
            .onConflictDoNothing({ target: wallets.userId });

          // ۲) creditِ اتمیک (قفلِ ردیف). این credit در صورتِ برخوردِ گام ۳ rollback می‌شود.
          const [updated] = await tx
            .update(wallets)
            .set({
              balanceToman: sql`${wallets.balanceToman} + ${args.amount}`,
              updatedAt: new Date(args.now),
            })
            .where(eq(wallets.userId, args.userId))
            .returning({ balanceToman: wallets.balanceToman });

          // ۳) ردیفِ دفترِ گرنت — یکتاییِ (user, refId) برای ردیف‌های 'grant' توسطِ
          //    ایندکسِ partial تضمین می‌شود. onConflictDoNothing: اگر این (کاربر، ماه)
          //    قبلاً گرنت خورده، ۰ ردیف درج می‌شود → سنتینل → rollbackِ کلِ تراکنش.
          const inserted = await tx
            .insert(walletLedger)
            .values({
              userId: args.userId,
              kind: "grant",
              amountToman: args.amount,
              balanceAfterToman: updated.balanceToman,
              refType: "grant",
              refId: args.refId,
              description: args.description,
            })
            .onConflictDoNothing({
              target: [walletLedger.userId, walletLedger.refId],
              where: sql`${walletLedger.kind} = 'grant'`,
            })
            .returning({ id: walletLedger.id });

          if (inserted.length === 0) {
            // گرنتِ این ماه قبلاً هست → کلِ تراکنش (شاملِ creditِ گام ۲) را برگردان.
            throw GRANT_ALREADY_EXISTS;
          }
        });
      } catch (err) {
        if (err === GRANT_ALREADY_EXISTS) return { already: true };
        throw err;
      }

      return { already: false };
    },
  };
}

/** خواننده‌ی پلنِ کاربر (برای حالتی که فراخواننده پلن را پاس ندهد). */
async function readPlan(userId: string, db: GrantsDb): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.plan ?? "free";
}

/** وابستگی‌های قابلِ تزریقِ گرنت — برای تستِ بدونِ DB. */
export interface GrantDeps {
  db?: GrantsDb;
  /** storeِ پایداری — پیش‌فرض drizzleGrantStore(db). */
  store?: GrantStore;
  /** پلنِ کاربر (اگر داده شود، خواندنِ users رد می‌شود). */
  plan?: Plan;
}

/**
 * اعتبارِ ماهانه‌ی هوش مصنوعیِ یک کاربر را برای ماهِ جاری credit می‌کند — *ایدمپوتنت*.
 *
 * گردشِ کار:
 *   ۱) پلنِ کاربر (تزریقی یا از users). مبلغ = monthlyCreditToman پلن.
 *   ۲) اگر مبلغ ۰ باشد (پلنِ Free/بی‌اعتبار) → granted=false، بدونِ نوشتن.
 *   ۳) وگرنه grantOnce: اگر refIdِ این ماه قبلاً هست → granted=false؛ وگرنه credit
 *      و ردیفِ دفترِ 'grant' → granted=true.
 *
 * @param now زمانِ مرجع برای تعیینِ ماه — تزریقی برای تست/کرانِ تاریخی.
 */
export async function grantMonthlyCredits(
  userId: string,
  deps: GrantDeps = {},
  now: number = Date.now(),
): Promise<GrantResult> {
  const db = deps.db ?? defaultDb;
  const plan = deps.plan ?? (await readPlan(userId, db));
  const amount = monthlyCreditFor(plan);
  const period = periodMonthOf(now);
  const refId = grantRefId(userId, period);

  // پلنِ بی‌اعتبار (Free/legacy payg → free): چیزی credit نمی‌شود.
  if (!(amount > 0)) {
    return { granted: false, amount: 0, period, refId };
  }

  const store = deps.store ?? drizzleGrantStore(db);
  const description = `اعتبارِ ماهانه‌ی پلنِ ${normalizePlanKey(plan)} (${period})`;
  const { already } = await store.grantOnce({
    userId,
    amount,
    refId,
    description,
    now,
  });

  return {
    granted: !already,
    amount: already ? 0 : amount,
    period,
    refId,
  };
}

/* ───────────────────────  storeِ in-memory برای تست  ────────────────────── */

/** یک GrantStoreِ in-memory برای تست — refIdهای داده‌شده را در حافظه نگه می‌دارد. */
export function inMemoryGrantStore(
  initialBalances: Record<string, number> = {},
): GrantStore & {
  balances: Map<string, number>;
  grantedRefIds: Set<string>;
} {
  const balances = new Map<string, number>(Object.entries(initialBalances));
  const grantedRefIds = new Set<string>();

  return {
    balances,
    grantedRefIds,
    async grantOnce(args) {
      if (grantedRefIds.has(args.refId)) return { already: true };
      grantedRefIds.add(args.refId);
      balances.set(args.userId, (balances.get(args.userId) ?? 0) + args.amount);
      return { already: false };
    },
  };
}
