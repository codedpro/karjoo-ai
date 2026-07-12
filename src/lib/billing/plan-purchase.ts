import "server-only";

/**
 * خریدِ پلن روی کیف‌پولِ واحدِ 1xai — ماشینِ حالتِ ضدِکرش و ضدِمسابقه (server-only).
 *
 * چرا این ماژول؟ کسرِ پول (سمتِ 1xai) و ثبتِ پلن (DBِ کارجو) دو سیستمِ جدا هستند؛
 * بینِ هر دو گامی ممکن است کرش یا درخواستِ هم‌زمان رخ دهد. سه ستونِ ایمنی:
 *
 *  ۱) referenceِ *بدونِ زمان*: هر خرید یک ردیفِ `plan_purchases` با reference =
 *     `plan:<rowId>` می‌گیرد که *در همان INSERT* ست می‌شود. retry پس از هر کرشی — حتی
 *     پس از رفتنِ ماهِ UTC — به همان reference می‌رسد و ایندکسِ یکتای سمتِ 1xai
 *     دوباره‌کسر را ساختاری ناممکن می‌کند.
 *
 *  ۲) گذارهای *مقایسه‌و‌ست* (compare-and-set): هر تغییرِ وضعیت فقط از وضعیت‌های
 *     موردانتظار مجاز است (UPDATE ... WHERE status IN (...) RETURNING). یک درخواستِ
 *     هم‌زمان که ردیف را abandoned/refund کرده نمی‌تواند توسطِ درخواستِ دیگر «زنده»
 *     شود — گذارِ ناموفق = PurchaseConflictError (۴۰۹ بالادست).
 *
 *  ۳) *ادعای completed پیش از اعطای پلن*: ردیف اول از debited به completed ادعا
 *     می‌شود (که آن را از دسترسِ settleِ هر درخواستِ دیگری خارج می‌کند) و فقط بعد
 *     users.plan ست می‌شود. کرش بینِ این دو، با «فعال‌سازیِ مجددِ» رایگانِ همان ماه
 *     (findCompletedSince) ترمیم می‌شود.
 *
 * ماشینِ حالت (plan_purchase_status):
 *   pending → debited → completed          (مسیرِ شاد)
 *   pending/debited → abandoned            (بی‌اثرِ مالیِ خالص: یا هرگز کسر نشد یا refund شد)
 *
 * سایر قواعد:
 *   • خریدِ بازِ ناهم‌خوان فقط پس از یک «پنجره‌ی امن» (SETTLE_GRACE_MS) settle می‌شود؛
 *     ردیفِ جوان‌تر یعنی درخواستِ زنده‌ی هم‌زمان → PurchaseConflictError (نه refundِ
 *     ردیفی که راننده‌اش هنوز در پرواز است).
 *   • فعال‌سازیِ مجددِ همان پلن در همان ماهِ UTC رایگان است (خریدِ completedِ این ماه
 *     دوباره شارژ نمی‌شود) — همان معنای طرحِ قدیمیِ month-keyed، بدونِ لبه‌ی کرشش.
 *   • settleOpenPurchase برای مسیرِ *پایین‌آوردن* export شده: هیچ تغییرِ پلنی حق ندارد
 *     ردیفِ بازِ (پولِ معلق) را دور بزند — اول تکلیفِ پول روشن می‌شود.
 */
import { and, eq, gte, inArray } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { planPurchases, users, type Plan, type PlanPurchase } from "@/db/schema";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import {
  creditUnified,
  debitUnified,
  getUnifiedBalance,
  type UnifiedDeps,
} from "@/lib/billing/unified";

/** هندلِ DB تزریق‌پذیر. */
export type PlanPurchaseDb = typeof defaultDb;

/** درخواستِ هم‌زمانِ ناسازگار روی خریدِ باز — بالادست ۴۰۹ می‌دهد؛ retry امن است. */
export class PurchaseConflictError extends Error {
  constructor(message = "یک تغییرِ پلنِ دیگر برای این حساب در جریان است؛ چند لحظه بعد دوباره تلاش کنید.") {
    super(message);
    this.name = "PurchaseConflictError";
  }
}

/**
 * پنجره‌ی امنِ settle: ردیفِ بازِ جوان‌تر از این احتمالاً راننده‌ی زنده دارد (کلِ ماشین
 * چند await است)؛ فقط ردیفِ کهنه‌تر — یعنی به‌جامانده از کرشِ واقعی — settle می‌شود.
 */
export const SETTLE_GRACE_MS = 10 * 60_000;

/** آغازِ ماهِ جاریِ UTC — دامنه‌ی «فعال‌سازیِ مجددِ رایگان». */
export function monthStartUtc(now: number = Date.now()): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** زیرمجموعه‌ی ردیفِ خرید که ماشینِ حالت نیاز دارد. */
export interface PurchaseRow {
  id: string;
  userId: string;
  plan: Plan;
  amountToman: number;
  reference: string;
  status: "pending" | "debited" | "completed" | "abandoned";
  /** برای پنجره‌ی امنِ settle (سنِ ردیف). */
  updatedAt: Date;
}

/** درزِ پایداریِ خرید — همه‌ی نوشتن/خواندن‌های DBِ این ماشین از این‌جا می‌گذرد. */
export interface PurchaseStore {
  /** ردیفِ بازِ (pending/debited) کاربر، اگر باشد. */
  findOpen(userId: string): Promise<PurchaseRow | undefined>;
  /** خریدِ completedِ همین پلن از `since` به بعد (فعال‌سازیِ مجددِ رایگانِ همان ماه). */
  findCompletedSince(userId: string, plan: Plan, since: Date): Promise<PurchaseRow | undefined>;
  /**
   * ردیفِ تازه (pending) — id در اپ ساخته و reference (`plan:<id>`) *در همان درج*
   * اتمیک ست می‌شود (حالتِ «referenceِ خالی» وجود ندارد؛ وگرنه دو کاربرِ هم‌زمان روی
   * یکتاییِ سراسریِ reference تصادم می‌کردند). یکتاییِ «یک بازِ هم‌زمان به‌ازای هر
   * کاربر» → throw (مسابقه‌ی دوکلیک).
   */
  create(userId: string, plan: Plan, amountToman: number): Promise<PurchaseRow>;
  /**
   * گذارِ مقایسه‌و‌ست: فقط اگر وضعیتِ فعلی در `expected` باشد اعمال و true برمی‌گردد.
   * false = درخواستِ هم‌زمانی ردیف را برده (فراخواننده باید PurchaseConflictError بدهد).
   */
  transition(
    id: string,
    to: PurchaseRow["status"],
    expected: PurchaseRow["status"][],
  ): Promise<boolean>;
  /**
   * ادعای completed + اعطای پلن، *در یک تراکنشِ DB* (هر دو نوشتن روی Postgresِ خودِ
   * کارجوست، پس پنجره‌ی کرشِ بینشان اصلاً وجود ندارد — رفعِ لبه‌ی «پولِ گمِ» کرشِ
   * میان‌ماهی). CAS از 'debited': false = ردیف را درخواستِ دیگری برده (هیچ‌کدام از دو
   * نوشتن اعمال نمی‌شود).
   */
  completeAndGrant(id: string, userId: string, plan: Plan): Promise<boolean>;
  /** ثبتِ استحقاق: users.plan (برای فعال‌سازیِ مجددِ بدونِ خرید). */
  setUserPlan(userId: string, plan: Plan): Promise<void>;
}

/** پیاده‌سازیِ تولید روی Drizzle. */
export function drizzlePurchaseStore(db: PlanPurchaseDb = defaultDb): PurchaseStore {
  return {
    async findOpen(userId) {
      const [row] = await db
        .select()
        .from(planPurchases)
        .where(
          and(
            eq(planPurchases.userId, userId),
            inArray(planPurchases.status, ["pending", "debited"]),
          ),
        )
        .limit(1);
      return row as PlanPurchase | undefined;
    },
    async findCompletedSince(userId, plan, since) {
      const [row] = await db
        .select()
        .from(planPurchases)
        .where(
          and(
            eq(planPurchases.userId, userId),
            eq(planPurchases.plan, plan),
            eq(planPurchases.status, "completed"),
            gte(planPurchases.completedAt, since),
          ),
        )
        .limit(1);
      return row as PlanPurchase | undefined;
    },
    async create(userId, plan, amountToman) {
      // id در اپ تا reference در همان INSERT ست شود (بدونِ حالتِ میانیِ خالی).
      const id = crypto.randomUUID();
      const [created] = await db
        .insert(planPurchases)
        .values({ id, userId, plan, amountToman, reference: `plan:${id}` })
        .returning();
      return created;
    },
    async transition(id, to, expected) {
      const rows = await db
        .update(planPurchases)
        .set({
          status: to,
          updatedAt: new Date(),
          ...(to === "completed" ? { completedAt: new Date() } : {}),
        })
        .where(and(eq(planPurchases.id, id), inArray(planPurchases.status, expected)))
        .returning({ id: planPurchases.id });
      return rows.length > 0;
    },
    async completeAndGrant(id, userId, plan) {
      // یک تراکنش: CAS ادعای completed + اعطای پلن — یا هر دو یا هیچ‌کدام.
      return db.transaction(async (tx) => {
        const claimed = await tx
          .update(planPurchases)
          .set({ status: "completed", updatedAt: new Date(), completedAt: new Date() })
          .where(and(eq(planPurchases.id, id), eq(planPurchases.status, "debited")))
          .returning({ id: planPurchases.id });
        if (claimed.length === 0) return false;
        await tx
          .update(users)
          .set({ plan, updatedAt: new Date() })
          .where(eq(users.id, userId));
        return true;
      });
    },
    async setUserPlan(userId, plan) {
      await db
        .update(users)
        .set({ plan, updatedAt: new Date() })
        .where(eq(users.id, userId));
    },
  };
}

/** وابستگی‌های تزریق‌پذیر — debit/credit/balanceِ سطحِ کارجو + store؛ تستِ بدونِ DB/شبکه. */
export interface PlanPurchaseDeps extends UnifiedDeps {
  store?: PurchaseStore;
  debitUnifiedFn?: typeof debitUnified;
  creditUnifiedFn?: typeof creditUnified;
  getUnifiedBalanceFn?: typeof getUnifiedBalance;
  /** ساعتِ تزریقی (پنجره‌ی امن/ماه) — تست‌ها زمان می‌دهند. */
  now?: () => number;
}

/** نتیجه‌ی خریدِ موفق. */
export interface PurchaseResult {
  balanceToman: number;
  purchaseId: string;
  /** true = خریدِ completedِ همین ماه دوباره فعال شد (بدونِ کسرِ تازه). */
  reactivated?: boolean;
}

/**
 * یک خریدِ بازِ به‌جامانده را به حالتِ خنثیِ مالی می‌بندد. فقط ردیفِ *کهنه‌تر از
 * پنجره‌ی امن* — ردیفِ جوان راننده‌ی زنده دارد → PurchaseConflictError.
 *
 * ترتیبِ خنثی‌سازی: اول وضعیتِ پول با debitِ همان reference قطعی می‌شود (کرشِ قبلی →
 * already=true؛ وگرنه همین حالا می‌نشیند — هر دو به «پول داخل است» می‌رسند)، سپس
 * refundِ کاملِ idempotent (`plan-refund:<rowId>`) و گذارِ مقایسه‌و‌ستِ → abandoned.
 * اگر موجودی برای قطعی‌سازی کافی نبود، پول هرگز کسر نشده → فقط abandoned.
 * (refundِ تکراری در retry بی‌اثر است — همان reference.)
 */
async function settleStale(
  store: PurchaseStore,
  open: PurchaseRow,
  debit: typeof debitUnified,
  credit: typeof creditUnified,
  now: () => number,
  deps: PlanPurchaseDeps,
): Promise<void> {
  if (now() - open.updatedAt.getTime() < SETTLE_GRACE_MS) {
    throw new PurchaseConflictError();
  }

  if (open.reference) {
    try {
      await debit(open.userId, open.amountToman, open.reference, deps);
    } catch (err) {
      if (!(err instanceof InsufficientBalanceError)) throw err; // svc قطع → باز بماند.
      // پول هرگز ننشسته و نمی‌تواند بنشیند → بدونِ refund مستقیم به بستن.
      if (!(await store.transition(open.id, "abandoned", ["pending", "debited"]))) {
        throw new PurchaseConflictError();
      }
      return;
    }
    // پول قطعاً داخل است → بازگشتِ کاملِ idempotent.
    await credit(open.userId, open.amountToman, "refund", `plan-refund:${open.id}`, deps);
  }

  // گذارِ مقایسه‌و‌ست: اگر درخواستِ دیگری هم‌زمان completed کرده باشد، false — که یعنی
  // ردیفی را refund کرده‌ایم که کامل شد (فقط با توقفِ >پنجره‌ی امنِ راننده ممکن است).
  if (!(await store.transition(open.id, "abandoned", ["pending", "debited"]))) {
    console.error(
      `[billing] CRITICAL: خریدِ ${open.id} حینِ settle توسطِ درخواستِ دیگری completed شد و refund (plan-refund:${open.id}) هم رفته — بازبینیِ دستی لازم است.`,
    );
    throw new PurchaseConflictError();
  }
}

/**
 * هر ردیفِ بازِ کاربر را (فارغ از پلنش) settle می‌کند — برای مسیرِ *پایین‌آوردن*: هیچ
 * تغییرِ پلنی حق ندارد پولِ معلقِ یک ارتقایِ کرش‌کرده را دور بزند (وگرنه کسرِ ۲۹۹هزار
 * تومانیِ بی‌پلن برای همیشه معلق می‌ماند). بدونِ ردیفِ باز = بی‌اثر.
 */
export async function settleOpenPurchase(
  karjooUserId: string,
  deps: PlanPurchaseDeps = {},
): Promise<void> {
  const store = deps.store ?? drizzlePurchaseStore(deps.db);
  const debit = deps.debitUnifiedFn ?? debitUnified;
  const credit = deps.creditUnifiedFn ?? creditUnified;
  const now = deps.now ?? Date.now;

  const open = await store.findOpen(karjooUserId);
  if (!open) return;
  await settleStale(store, open, debit, credit, now, deps);
}

/**
 * خریدِ پلن — تنها مسیرِ مجازِ کسرِ قیمتِ پلن از کیف‌پولِ واحد.
 *
 * @throws {InsufficientBalanceError} موجودی کافی نیست (خرید abandoned شد؛ ۴۰۲ بالادست).
 * @throws {PurchaseConflictError} درخواستِ هم‌زمانِ ناسازگار (۴۰۹؛ retryِ کوتاه‌مدت امن است).
 * @throws {OnexaiSvcUnavailableError|OnexaiLinkError} زیرساخت — خرید باز می‌ماند (۵۰۳؛ retry ادامه می‌دهد).
 */
export async function purchasePlan(
  karjooUserId: string,
  target: Plan,
  priceToman: number,
  deps: PlanPurchaseDeps = {},
): Promise<PurchaseResult> {
  const store = deps.store ?? drizzlePurchaseStore(deps.db);
  const debit = deps.debitUnifiedFn ?? debitUnified;
  const credit = deps.creditUnifiedFn ?? creditUnified;
  const getBalance = deps.getUnifiedBalanceFn ?? getUnifiedBalance;
  const now = deps.now ?? Date.now;

  // ۱) خریدِ بازِ قبلی؟ (کرشِ وسطِ خریدِ قبلی یا دوکلیک)
  let purchase = await store.findOpen(karjooUserId);

  if (purchase && (purchase.plan !== target || purchase.amountToman !== priceToman)) {
    // ناهم‌خوان → فقط اگر کهنه است (کرشِ واقعی) خنثیِ مالی می‌شود؛ جوان = ۴۰۹.
    await settleStale(store, purchase, debit, credit, now, deps);
    purchase = undefined;
  }

  // ۲) فعال‌سازیِ مجددِ رایگان: خریدِ completedِ همین پلن در همین ماهِ UTC → بدونِ کسرِ
  //    تازه فقط پلن ست می‌شود. هم معنای productِ «پایین‌آوردن و برگشت در همان ماه،
  //    بدونِ پرداختِ دوباره» و هم ترمیمِ کرشِ بینِ completed و setUserPlan.
  if (!purchase) {
    const done = await store.findCompletedSince(karjooUserId, target, monthStartUtc(now()));
    if (done) {
      await store.setUserPlan(karjooUserId, target);
      const bal = await getBalance(karjooUserId, deps);
      return { balanceToman: bal.availableToman, purchaseId: done.id, reactivated: true };
    }
  }

  // ۳) نبود → ردیفِ تازه؛ reference (`plan:<rowId>`، بدونِ زمان) در همان درج اتمیک ست می‌شود.
  if (!purchase) {
    try {
      purchase = await store.create(karjooUserId, target, priceToman);
    } catch (err) {
      // یکتاییِ «خریدِ باز» → مسابقه‌ی دوکلیک: ردیفِ بازِ برنده را بخوان و ادامه بده.
      const open = await store.findOpen(karjooUserId);
      if (!open) throw err;
      if (open.plan !== target || open.amountToman !== priceToman) {
        // برنده پلنِ دیگری می‌خرد — راننده‌ی زنده است (جوان) → ۴۰۹ (نه settleِ ردیفِ زنده).
        await settleStale(store, open, debit, credit, now, deps);
        return purchasePlan(karjooUserId, target, priceToman, deps);
      }
      purchase = open;
    }
  }

  // ۴) کسر — idempotent با referenceِ پایدارِ ردیف (کرشِ قبلی → already=true).
  let balanceToman: number;
  try {
    const move = await debit(karjooUserId, purchase.amountToman, purchase.reference, deps);
    balanceToman = move.balanceToman;
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      await store.transition(purchase.id, "abandoned", ["pending", "debited"]);
    }
    // svc قطع → ردیف باز می‌ماند تا retry از همین reference ادامه دهد.
    throw err;
  }
  if (!(await store.transition(purchase.id, "debited", ["pending", "debited"]))) {
    // درخواستِ هم‌زمانی ردیف را برد (abandoned/refund شد) — این راننده حقِ ادامه ندارد.
    throw new PurchaseConflictError();
  }

  // ۵) ادعای completed + اعطای پلن، *اتمیک در یک تراکنشِ DBِ کارجو*: یا هر دو یا
  //    هیچ‌کدام — پنجره‌ی کرشِ «پول رفته، completed شده، پلن نه» اصلاً وجود ندارد.
  //    شکستِ CAS = ردیف را درخواستِ هم‌زمانی برده (abandoned/refund) → هیچ پلنی
  //    اعطا نمی‌شود (۴۰۹). شکستِ خودِ تراکنش (کرش/قطعیِ DB) → ردیفِ debited می‌ماند و
  //    retry با debitِ بی‌اثر (already=true) دوباره به همین‌جا می‌رسد.
  if (!(await store.completeAndGrant(purchase.id, karjooUserId, target))) {
    throw new PurchaseConflictError();
  }

  return { balanceToman, purchaseId: purchase.id };
}

/* ───────────────────────  storeِ in-memory برای تست  ────────────────────── */

/** PurchaseStoreِ حافظه‌ای — همان قواعد (یکتاییِ باز، گذارِ مقایسه‌و‌ست) بدونِ DB. */
export function inMemoryPurchaseStore(nowFn: () => number = Date.now): PurchaseStore & {
  rows: PurchaseRow[];
  userPlans: Map<string, Plan>;
  completedAt: Map<string, Date>;
} {
  const rows: PurchaseRow[] = [];
  const userPlans = new Map<string, Plan>();
  const completedAt = new Map<string, Date>();
  let seq = 0;

  return {
    rows,
    userPlans,
    completedAt,
    async findOpen(userId) {
      const r = rows.find(
        (x) => x.userId === userId && (x.status === "pending" || x.status === "debited"),
      );
      return r ? { ...r } : undefined;
    },
    async findCompletedSince(userId, plan, since) {
      const r = rows.find(
        (x) =>
          x.userId === userId &&
          x.plan === plan &&
          x.status === "completed" &&
          (completedAt.get(x.id)?.getTime() ?? 0) >= since.getTime(),
      );
      return r ? { ...r } : undefined;
    },
    async create(userId, plan, amountToman) {
      if (rows.some((r) => r.userId === userId && (r.status === "pending" || r.status === "debited"))) {
        throw new Error("unique violation: plan_purchases_open_user_uq");
      }
      seq += 1;
      const id = `pp-${seq}`;
      const row: PurchaseRow = {
        id,
        userId,
        plan,
        amountToman,
        reference: `plan:${id}`, // مثلِ تولید: اتمیک در همان ساخت.
        status: "pending",
        updatedAt: new Date(nowFn()),
      };
      rows.push(row);
      return { ...row };
    },
    async transition(id, to, expected) {
      const r = rows.find((x) => x.id === id);
      if (!r || !expected.includes(r.status)) return false;
      r.status = to;
      r.updatedAt = new Date(nowFn());
      if (to === "completed") completedAt.set(id, new Date(nowFn()));
      return true;
    },
    async completeAndGrant(id, userId, plan) {
      // مثلِ تولید اتمیک (این‌جا سنکرون): CAS از debited + اعطای پلن، یا هیچ‌کدام.
      const r = rows.find((x) => x.id === id);
      if (!r || r.status !== "debited") return false;
      r.status = "completed";
      r.updatedAt = new Date(nowFn());
      completedAt.set(id, new Date(nowFn()));
      userPlans.set(userId, plan);
      return true;
    },
    async setUserPlan(userId, plan) {
      userPlans.set(userId, plan);
    },
  };
}
