import "server-only";

/**
 * کیف‌پولِ کاربر + دفترِ تراکنش (server-only) — هسته‌ی پولِ کارجو.
 *
 * تضمین‌های ایمنی:
 *   • هر credit/debit دقیقاً یک ردیفِ wallet_ledger با balanceAfter می‌سازد، در یک
 *     تراکنشِ اتمیک با به‌روزرسانیِ موجودی (یا هر دو، یا هیچ‌کدام).
 *   • debit «گم‌نشدنی» است زیرِ همزمانی: به‌جای read-modify-write در اپ، موجودی را با
 *     یک `UPDATE … SET balance = balance − amount … RETURNING` به‌روز می‌کنیم. این
 *     آپدیت ردیفِ کیف‌پول را قفل می‌کند؛ پس دو debitِ همزمان سریالایز می‌شوند و هیچ‌کدام
 *     روی هم بازنویسی نمی‌شوند (atomic increment سمت DB).
 *
 * درزِ تست‌پذیری: عملیاتِ پایداری پشتِ یک `WalletStore` کپسوله شده. پیاده‌سازیِ تولید
 * (drizzleWalletStore) یک تراکنشِ Drizzle با UPDATE اتمیک می‌زند؛ تست یک storeِ
 * in-memory تزریق می‌کند تا منطق بدونِ DB راستی‌آزمایی شود.
 */
import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  wallets,
  walletLedger,
  type LedgerKind,
  type Wallet,
} from "@/db/schema";

/** هندلِ کاملِ Drizzle که پیاده‌سازیِ تولید نیاز دارد (به transaction نیاز است). */
export type WalletDb = typeof defaultDb;

/** نوعِ ساعت تزریق‌پذیر (پیش‌فرض Date.now). */
export type Clock = () => number;

/** ارجاعِ منبعِ یک رویدادِ دفتر — برای ردگیریِ این‌که این کسر/شارژ از کجا آمد. */
export interface LedgerRef {
  /** نوعِ منبع، مثلاً 'usage_record' | 'topup' | 'grant'. */
  refType?: string;
  refId?: string;
  description?: string;
}

/** نتیجه‌ی یک تغییرِ موجودی — موجودیِ جدید + شناسه‌ی ردیفِ دفترِ ساخته‌شده. */
export interface WalletMutationResult {
  balanceToman: number;
  ledgerId: string;
}

/**
 * درزِ پایداریِ کیف‌پول. هر تغییرِ موجودی *به‌صورتِ اتمیک* انجام و ردیفِ دفتر ثبت می‌شود.
 * یک متد، چون atomic بودنِ «تغییرِ موجودی + ثبتِ دفتر» جدانشدنی است.
 */
export interface WalletStore {
  /**
   * موجودی را به‌صورتِ اتمیک delta واحد تغییر می‌دهد و یک ردیفِ دفتر با balanceAfter
   * ثبت می‌کند. کیف‌پول را در صورتِ نبود می‌سازد. موجودیِ جدید + شناسه‌ی دفتر را برمی‌گرداند.
   */
  mutate(args: {
    userId: string;
    delta: number;
    kind: LedgerKind;
    ref: LedgerRef;
    now: number;
  }): Promise<WalletMutationResult>;

  /** کیف‌پول را در صورتِ نبود می‌سازد و ردیفِ آن را برمی‌گرداند. */
  getOrCreate(userId: string): Promise<Wallet>;
}

/* ─────────────────────  پیاده‌سازیِ تولید (Drizzle, اتمیک)  ───────────────── */

/**
 * storeِ تولید روی Drizzle. هر mutate یک تراکنش است: تضمینِ کیف‌پول → UPDATE اتمیکِ
 * موجودی (قفلِ ردیف، گم‌نشدنی زیرِ همزمانی) → درجِ ردیفِ دفتر. یا هر سه یا هیچ‌کدام.
 */
export function drizzleWalletStore(db: WalletDb): WalletStore {
  return {
    async getOrCreate(userId: string): Promise<Wallet> {
      const [row] = await db
        .insert(wallets)
        .values({ userId })
        .onConflictDoNothing({ target: wallets.userId })
        .returning();
      if (row) return row;

      const [existing] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .limit(1);
      if (!existing) {
        throw new Error(`getOrCreateWallet: کیف‌پولِ کاربر ${userId} نه ساخته شد نه یافت شد.`);
      }
      return existing;
    },

    async mutate(args): Promise<WalletMutationResult> {
      return db.transaction(async (tx) => {
        // تضمینِ وجودِ کیف‌پول (idempotent).
        await tx
          .insert(wallets)
          .values({ userId: args.userId })
          .onConflictDoNothing({ target: wallets.userId });

        // به‌روزرسانیِ اتمیکِ موجودی (قفلِ ردیف → debit زیرِ همزمانی گم نمی‌شود).
        const [updated] = await tx
          .update(wallets)
          .set({
            balanceToman: sql`${wallets.balanceToman} + ${args.delta}`,
            updatedAt: new Date(args.now),
          })
          .where(eq(wallets.userId, args.userId))
          .returning({ balanceToman: wallets.balanceToman });

        if (!updated) {
          throw new Error(`wallet mutate: کیف‌پولِ کاربر ${args.userId} برای به‌روزرسانی یافت نشد.`);
        }
        const balanceAfter = updated.balanceToman;

        const [ledgerRow] = await tx
          .insert(walletLedger)
          .values({
            userId: args.userId,
            kind: args.kind,
            amountToman: args.delta,
            balanceAfterToman: balanceAfter,
            refType: args.ref.refType ?? null,
            refId: args.ref.refId ?? null,
            description: args.ref.description ?? null,
          })
          .returning({ id: walletLedger.id });

        return { balanceToman: balanceAfter, ledgerId: ledgerRow.id };
      });
    },
  };
}

/* ─────────────────────────────  API عمومی  ──────────────────────────────── */

/** storeِ پیش‌فرض را از یک هندلِ db می‌سازد (یا storeِ تزریق‌شده را برمی‌گرداند). */
function resolveStore(dbOrStore: WalletDb | WalletStore): WalletStore {
  // اگر متدِ mutate داشت، یک WalletStore است؛ وگرنه یک db که store می‌سازیم.
  if ("mutate" in dbOrStore && typeof (dbOrStore as WalletStore).mutate === "function") {
    return dbOrStore as WalletStore;
  }
  return drizzleWalletStore(dbOrStore as WalletDb);
}

/**
 * کیف‌پولِ کاربر را برمی‌گرداند و اگر نبود می‌سازد (idempotent). همیشه دقیقاً یک
 * کیف‌پول به‌ازای هر کاربر.
 */
export async function getOrCreateWallet(
  userId: string,
  store: WalletDb | WalletStore = defaultDb,
): Promise<Wallet> {
  return resolveStore(store).getOrCreate(userId);
}

/** موجودیِ تومانِ کاربر را برمی‌گرداند (کیف‌پول را می‌سازد اگر نبود → ۰). */
export async function getBalance(
  userId: string,
  store: WalletDb | WalletStore = defaultDb,
): Promise<number> {
  const wallet = await resolveStore(store).getOrCreate(userId);
  return wallet.balanceToman;
}

/**
 * موجودیِ کاربر را افزایش می‌دهد (شارژ/هدیه/بازگشت) و یک ردیفِ دفتر ثبت می‌کند.
 * مبلغِ منفی پذیرفته نمی‌شود (برای کسر از debit استفاده کنید).
 */
export async function credit(
  userId: string,
  kind: Extract<LedgerKind, "topup" | "grant" | "refund">,
  amountToman: number,
  ref: LedgerRef = {},
  store: WalletDb | WalletStore = defaultDb,
  now: Clock = Date.now,
): Promise<WalletMutationResult> {
  if (!(amountToman > 0)) {
    throw new Error("credit: مبلغ باید بزرگ‌تر از صفر باشد.");
  }
  return resolveStore(store).mutate({
    userId,
    delta: Math.round(amountToman),
    kind,
    ref,
    now: now(),
  });
}

/**
 * موجودیِ کاربر را کاهش می‌دهد (کسرِ بابتِ فراخوانیِ پولی) و یک ردیفِ دفتر با amount
 * منفی ثبت می‌کند. به‌صورتِ اتمیک و گم‌نشدنی زیرِ همزمانی (قفلِ ردیف).
 *
 * این تابع گیتِ موجودی را *اعمال نمی‌کند* (ممکن است موجودی منفی شود اگر مستقیم صدا
 * زده شود)؛ گیتِ «موجودی > ۰» در entitlement.assertCanUsePaidAi *پیش از* فراخوانی
 * انجام می‌شود و metering هزینه‌ی واقعیِ پس از فراخوانی را debit می‌کند.
 */
export async function debit(
  userId: string,
  kind: Extract<LedgerKind, "charge">,
  amountToman: number,
  ref: LedgerRef = {},
  store: WalletDb | WalletStore = defaultDb,
  now: Clock = Date.now,
): Promise<WalletMutationResult> {
  if (!(amountToman >= 0)) {
    throw new Error("debit: مبلغ نمی‌تواند منفی باشد.");
  }
  return resolveStore(store).mutate({
    userId,
    delta: -Math.round(amountToman),
    kind,
    ref,
    now: now(),
  });
}

/* ───────────────────────  storeِ in-memory برای تست  ────────────────────── */

/**
 * یک WalletStoreِ in-memory برای تست — همان منطقِ موجودی/دفتر را بدونِ DB پیاده می‌کند.
 * mutate به‌صورتِ سری (await پشتِ await) اتمیک است؛ تست‌ها race-safety را با
 * فراخوانیِ متوالی می‌سنجند (موجودیِ نهایی باید مجموعِ همه‌ی deltaها باشد).
 */
export function inMemoryWalletStore(
  initial: Record<string, number> = {},
): WalletStore & {
  balances: Map<string, number>;
  ledger: Array<{ userId: string; kind: LedgerKind; amount: number; balanceAfter: number; ref: LedgerRef }>;
} {
  const balances = new Map<string, number>(Object.entries(initial));
  const ledger: Array<{
    userId: string;
    kind: LedgerKind;
    amount: number;
    balanceAfter: number;
    ref: LedgerRef;
  }> = [];
  let ledgerSeq = 0;

  const store = {
    balances,
    ledger,
    async getOrCreate(userId: string): Promise<Wallet> {
      if (!balances.has(userId)) balances.set(userId, 0);
      return {
        id: `wallet-${userId}`,
        userId,
        balanceToman: balances.get(userId) ?? 0,
        updatedAt: new Date(0),
        createdAt: new Date(0),
      };
    },
    async mutate(args: {
      userId: string;
      delta: number;
      kind: LedgerKind;
      ref: LedgerRef;
      now: number;
    }): Promise<WalletMutationResult> {
      const current = balances.get(args.userId) ?? 0;
      const next = current + args.delta;
      balances.set(args.userId, next);
      ledgerSeq += 1;
      ledger.push({
        userId: args.userId,
        kind: args.kind,
        amount: args.delta,
        balanceAfter: next,
        ref: args.ref,
      });
      return { balanceToman: next, ledgerId: `ledger-${ledgerSeq}` };
    },
  };
  return store;
}
