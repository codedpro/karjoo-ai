import "server-only";

/**
 * کیف‌پول/هویتِ واحدِ خانواده‌ی 1xAi — helperهای سطحِ کارجو (server-only).
 *
 * «یک انسان، یک موجودی»: پول در 1xai زندگی می‌کند (users.balance_toman +
 * wallet_transactions آن‌جا)؛ کارجو فقط از طریقِ این لایه می‌خواند/حرکت می‌دهد.
 * این ماژول شناسه‌های *کارجویی* (uuid) می‌گیرد و خودش گره به استخر (onexaiUserId)
 * را برقرار/کش می‌کند — مصرف‌کننده‌ها هیچ‌چیز از /svc نمی‌دانند.
 *
 * قواعد:
 *   • fail-closed: اگر سرویس/گره برقرار نشود، خطای typed بالا می‌رود؛ هیچ مسیرِ
 *     پولی به کیف‌پولِ محلیِ بازنشسته برنمی‌گردد.
 *   • reference هر حرکتِ پول باید برای «رویداد» پایدار باشد (نه tainted به زمان)،
 *     تا retry با همان reference بی‌اثر بماند (idempotent سمتِ 1xai).
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users } from "@/db/schema";
import {
  creditPool,
  debitPool,
  getPoolBalance,
  issuePoolApiKey,
  resolveUser,
  type OnexaiBalance,
  type OnexaiMoveResult,
} from "@/lib/onexai/svc";
import {
  decryptSession,
  encryptSession,
  VaultDecryptionError,
  type EncryptedBlob,
} from "@/lib/vault/crypto";

/** هندلِ DB تزریق‌پذیر (تست‌ها db جعلی می‌دهند). */
export type UnifiedDb = typeof defaultDb;

/** کاربرِ کارجو ایمیل ندارد یا در استخر پیدا/ساخته نشد. */
export class OnexaiLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnexaiLinkError";
  }
}

/** وابستگی‌های تزریق‌پذیر برای تست (svcهای واقعی پیش‌فرض‌اند). */
export interface UnifiedDeps {
  db?: UnifiedDb;
  resolveUserFn?: typeof resolveUser;
  getPoolBalanceFn?: typeof getPoolBalance;
  debitPoolFn?: typeof debitPool;
  creditPoolFn?: typeof creditPool;
  issuePoolApiKeyFn?: typeof issuePoolApiKey;
  /** مهر/گشودنِ کلید در ذخیره‌سازی (پیش‌فرض خزانه‌ی AES-GCM) — تزریقی برای تست. */
  sealFn?: (raw: string) => string;
  openFn?: (stored: string) => string;
}

/**
 * گرهِ کاربرِ کارجو به استخرِ 1xai را برمی‌گرداند و در صورتِ نبود برقرار می‌کند
 * (resolve با email(+googleSub) → ذخیره‌ی onexai_user_id روی ردیفِ کاربر).
 */
export async function ensureOnexaiLink(
  karjooUserId: string,
  deps: UnifiedDeps = {},
): Promise<number> {
  const db = deps.db ?? defaultDb;
  const resolve = deps.resolveUserFn ?? resolveUser;

  const [row] = await db
    .select({
      onexaiUserId: users.onexaiUserId,
      email: users.email,
      googleSub: users.googleSub,
    })
    .from(users)
    .where(eq(users.id, karjooUserId))
    .limit(1);

  if (!row) throw new OnexaiLinkError("کاربرِ کارجو یافت نشد.");
  if (row.onexaiUserId) return row.onexaiUserId;
  if (!row.email) {
    throw new OnexaiLinkError("کاربر ایمیل ندارد؛ گره به حسابِ 1xai ممکن نیست.");
  }

  const pool = await resolve({
    email: row.email,
    ...(row.googleSub ? { googleSub: row.googleSub } : {}),
  });

  await db
    .update(users)
    .set({ onexaiUserId: pool.id, updatedAt: new Date() })
    .where(eq(users.id, karjooUserId));

  return pool.id;
}

/** موجودیِ واحدِ کاربرِ کارجو (تومانِ صحیح؛ گره در صورتِ نیاز برقرار می‌شود). */
export async function getUnifiedBalance(
  karjooUserId: string,
  deps: UnifiedDeps = {},
): Promise<OnexaiBalance> {
  const getBal = deps.getPoolBalanceFn ?? getPoolBalance;
  const poolId = await ensureOnexaiLink(karjooUserId, deps);
  return getBal(poolId);
}

/**
 * کسرِ idempotent از کیف‌پولِ واحدِ کاربرِ کارجو. `referenceSuffix` بدونِ پیشوند
 * داده می‌شود (این‌جا 'karjoo:' اضافه می‌شود) و باید برای رویداد پایدار باشد —
 * مثلاً `plan:{userId}:{plan}:{period}`.
 * موجودیِ ناکافی → InsufficientBalanceError (همان typedِ بیلینگِ کارجو).
 */
export async function debitUnified(
  karjooUserId: string,
  amountToman: number,
  referenceSuffix: string,
  deps: UnifiedDeps = {},
): Promise<OnexaiMoveResult> {
  if (!(amountToman > 0)) throw new Error("debitUnified: مبلغ باید مثبت باشد.");
  const debit = deps.debitPoolFn ?? debitPool;
  const poolId = await ensureOnexaiLink(karjooUserId, deps);
  return debit({
    onexaiUserId: poolId,
    amountToman: Math.round(amountToman),
    reference: `karjoo:${referenceSuffix}`,
  });
}

/**
 * واریزِ idempotent به کیف‌پولِ واحد (بازگشتِ وجه/مهاجرت) — آینه‌ی debitUnified.
 * فقط مسیرهای ادمین/داخلی (settle/refund/migration) باید صدا بزنند؛ هیچ endpointِ
 * کاربری‌ای نباید بتواند به این برسد (کاربر هرگز خودش را شارژ نمی‌کند).
 */
export async function creditUnified(
  karjooUserId: string,
  amountToman: number,
  kind: "topup" | "refund" | "adjustment",
  referenceSuffix: string,
  deps: UnifiedDeps = {},
): Promise<OnexaiMoveResult> {
  if (!(amountToman > 0)) throw new Error("creditUnified: مبلغ باید مثبت باشد.");
  const doCredit = deps.creditPoolFn ?? creditPool;
  const poolId = await ensureOnexaiLink(karjooUserId, deps);
  return doCredit({
    onexaiUserId: poolId,
    amountToman: Math.round(amountToman),
    kind,
    reference: `karjoo:${referenceSuffix}`,
  });
}

/* ─────────────────  مهر و مومِ کلیدِ API در ذخیره‌سازی (at-rest)  ───────────────── */

/**
 * کلیدِ خامِ 1xai را با خزانه‌ی AES-256-GCM (همان KARJOO_VAULT_KEYِ نشست‌های بردها)
 * مهر می‌کند — ذخیره به‌صورتِ JSONِ EncryptedBlob. اگر خزانه پیکربندی نشده باشد
 * VaultNotConfiguredError بالا می‌رود (fail-closed: هرگز plaintext ذخیره نمی‌کنیم؛
 * کلیدِ کاربر مستقیماً کیف‌پولِ واحدش را خرج می‌کند و نشتِ DBِ کارجو نباید کافی باشد).
 */
function sealApiKey(raw: string): string {
  return JSON.stringify(encryptSession(raw));
}

/**
 * مقدارِ ذخیره‌شده را می‌گشاید. `{`-آغاز = بلابِ مهرشده؛ غیرِ آن میراثِ plaintext است
 * (امروز هیچ ردیفی ندارد — صرفاً دفاعی) و همان‌طور برگردانده می‌شود تا فراخواننده
 * فرصتِ چرخش داشته باشد. خطای رمزگشایی (چرخشِ KARJOO_VAULT_KEY) به فراخواننده می‌رسد.
 */
function openApiKey(stored: string): string {
  if (!stored.startsWith("{")) return stored;
  const blob = JSON.parse(stored) as EncryptedBlob;
  return decryptSession(blob);
}

/**
 * کلیدِ APIِ 1xaiِ خودِ کاربر را برمی‌گرداند؛ اگر هنوز صادر نشده، از استخر می‌گیرد و
 * *مهرشده* (AES-GCM خزانه) روی ردیفِ کاربر ذخیره می‌کند. فراخوانی‌های AI با این کلید
 * = مترشدن با نرخِ خودِ کاربر از کیف‌پولِ واحد (مدلِ «کارجو فقط از پلن پول درمی‌آورد»).
 *
 * خودترمیمی: اگر بلابِ ذخیره‌شده دیگر بازنشدنی بود (چرخشِ کلیدِ خزانه)، یک کلیدِ تازه
 * از استخر صادر و جایگزین می‌شود (کلیدِ قدیمی سمتِ 1xai معتبر می‌ماند ولی جایی
 * plaintext وجود ندارد که لو برود؛ در گزارشِ چرخشِ خزانه باید کلیدهای یتیم پاک شوند).
 */
export async function ensureOnexaiApiKey(
  karjooUserId: string,
  deps: UnifiedDeps = {},
): Promise<string> {
  const db = deps.db ?? defaultDb;
  const issue = deps.issuePoolApiKeyFn ?? issuePoolApiKey;
  const seal = deps.sealFn ?? sealApiKey;
  const open = deps.openFn ?? openApiKey;

  const [row] = await db
    .select({ onexaiApiKey: users.onexaiApiKey })
    .from(users)
    .where(eq(users.id, karjooUserId))
    .limit(1);

  if (row?.onexaiApiKey) {
    try {
      return open(row.onexaiApiKey);
    } catch (err) {
      if (!(err instanceof VaultDecryptionError)) throw err;
      // چرخشِ کلیدِ خزانه → بلابِ قدیمی بازنشدنی است؛ کلیدِ تازه صادر و جایگزین کن.
      console.warn(
        `[unified] کلیدِ مهرشده‌ی کاربر ${karjooUserId} بازنشدنی بود (چرخشِ خزانه؟) — کلیدِ تازه صادر می‌شود.`,
      );
    }
  }

  const poolId = await ensureOnexaiLink(karjooUserId, deps);
  const key = await issue(poolId, "karjoo");

  await db
    .update(users)
    .set({ onexaiApiKey: seal(key), updatedAt: new Date() })
    .where(eq(users.id, karjooUserId));

  return key;
}
