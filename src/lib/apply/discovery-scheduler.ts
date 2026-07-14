import "server-only";

import { and, eq, exists, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { client, db as defaultDb, type Database } from "@/db";
import {
  boardAccounts,
  sessionBlobs,
  userServerAutoApply,
  users,
  type Plan,
} from "@/db/schema";
import {
  assertServerAutoApplyAllowed,
  ServerAutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import { runFilterApply, type RunFilterApplyReport } from "@/lib/apply/orchestrator";
import { liveBoardIds } from "@/lib/apply/registry";
import { assertCanUsePaidAi } from "@/lib/billing/entitlement";
import { applyQuotaFor } from "@/lib/billing/plans";

/**
 * زمان‌بندِ کشفِ سطحِ سرور (top-up).
 *
 * پُرکننده‌ی صفِ اپلایِ خودکارِ سرور: کاربرانی که (۱) تاگلِ اپلای خودکارِ سرور را روشن
 * کرده‌اند، (۲) پلنشان حقِ ورکر دارد و سقفِ روزانه‌شان پر نشده، و (۳) نشستِ معتبرِ یک
 * سایتِ زنده دارند (تا ناوگان بتواند واقعاً اپلای کند) را می‌یابد و برای هرکدام یک
 * `runFilterApply` با **فیلترِ هوشمند (AI)** اجرا می‌کند.
 *
 * چرا فقط AI؟ اپلای خودکارِ سرور واقعاً *ثبت* می‌کند؛ پس فقط آگهی‌های بالای آستانه‌ی
 * کیفیتِ کاربر باید صف شوند. بی‌موجودیِ AI → هیچ اپلایی صف نمی‌شود (fail-closed روی پول،
 * بی‌اسپندِ ناخواسته). هزینه‌ی امتیازدهی به کیف‌پولِ *همان کاربر* با نرخِ 1xai بسته می‌شود.
 *
 * ایزوله‌سازیِ خطا: شکستِ یک کاربر کلِ دسته را متوقف نمی‌کند. مسیر با رازِ داخلی محافظت
 * می‌شود (route جدا) و بیرونی (cron) صدایش می‌زند.
 */

/** بیشینه‌ی کاربرانِ پردازش‌شده در هر دور (گاردِ زمان/هزینه؛ با چرخشِ منصفانه پوشش کامل می‌شود). */
export const DEFAULT_DISCOVERY_BATCH = 100;
/** سقفِ ایمنیِ تعدادِ کاندیداهای خوانده‌شده پیش از فیلترِ نشست. */
const MAX_DISCOVERY_CANDIDATES = 1000;
/** بودجه‌ی دیوارِ-ساعتِ هر دور (ms) — پیش از سررسیدِ cron/تابع می‌ایستد تا اجراها روی هم نیفتند. */
export const DEFAULT_DISCOVERY_BUDGET_MS = 4 * 60_000;
/** کلیدِ قفلِ مشورتیِ سراسریِ کشف — دو تیکِ هم‌پوشانِ cron را سریالی می‌کند (ضدِ دوباره‌شارژ). */
const DISCOVERY_LOCK_KEY = 0x6b61726a; // "karj"

/** یک کاربرِ کاندیدای کشفِ سرور (تاگل روشن + نشستِ معتبر). */
export interface EligibleUser {
  userId: string;
  plan: Plan;
}

/** نتیجه‌ی پردازشِ یک کاربر در این دور. */
export interface DiscoveryUserOutcome {
  userId: string;
  status: "queued" | "skipped" | "error";
  /** فقط status='queued': تعداد اپلای‌های تازه‌ی صف‌شده. */
  queued?: number;
  /** دلیلِ رد/خطا (کدِ کوتاه، بدون افشای راز). */
  reason?: string;
}

/** خلاصه‌ی یک دورِ کاملِ کشفِ سرور. */
export interface ServerDiscoverySummary {
  /** اگر true، دورِ دیگری در حال اجرا بود و این تیک بی‌اثر رد شد (قفلِ مشورتی). */
  skippedLocked?: boolean;
  eligible: number;
  /** کاربرانی که واقعاً پردازش شدند (ممکن است به‌خاطرِ بودجه‌ی زمان < eligible باشد). */
  processed: number;
  /** کاربرانِ واجدِ شرایطِ پردازش‌نشده در این دور (بودجه/سقف) — دورِ بعد اولویت دارند. */
  deferred: number;
  /** آیا اجرا به‌خاطرِ بودجه‌ی زمان زودتر ایستاد؟ */
  deadlineHit: boolean;
  queuedUsers: number;
  skipped: number;
  errors: number;
  totalQueued: number;
  outcomes: DiscoveryUserOutcome[];
}

/** وابستگی‌های تزریق‌پذیر (برای تست). */
export interface ServerDiscoveryDeps {
  db?: Database;
  /** بیشینه‌ی کاربرانِ این دور (پیش‌فرض DEFAULT_DISCOVERY_BATCH). */
  limit?: number;
  /** بودجه‌ی دیوارِ-ساعتِ این دور به ms (پیش‌فرض DEFAULT_DISCOVERY_BUDGET_MS). */
  budgetMs?: number;
  /** ساعتِ تزریقی (برای تستِ بودجه‌ی زمان) — پیش‌فرض Date.now. */
  now?: () => number;
  /** فهرست‌کننده‌ی کاربرانِ واجدِ شرایط — پیش‌فرض listEligibleForServerDiscovery. */
  listEligible?: (conn: Database, limit: number) => Promise<EligibleUser[]>;
  /** گیتِ سطحِ سرور (plan/toggle/quota) — پیش‌فرض assertServerAutoApplyAllowed؛ minScore برمی‌گرداند. */
  assertAllowed?: (userId: string, plan: Plan) => Promise<{ minScore: number }>;
  /** گیتِ موجودیِ AI — پیش‌فرض assertCanUsePaidAi؛ throw → کاربر رد می‌شود (بی‌اسپند). */
  canUsePaidAi?: (userId: string) => Promise<unknown>;
  /** اجراگرِ کشف — پیش‌فرض runFilterApply. */
  runFilter?: (opts: {
    userId: string;
    aiFilter: boolean;
    threshold: number;
    dailyCap: number;
    db?: Database;
  }) => Promise<RunFilterApplyReport>;
  /** ثبتِ «تلاش‌شده» برای چرخش — پیش‌فرض به‌روزرسانیِ last_discovery_at این کاربران. */
  markAttempted?: (conn: Database, userIds: string[]) => Promise<void>;
}

/**
 * کاربرانِ واجدِ شرایطِ کشفِ سرور را برمی‌گرداند: تاگلِ سرور روشن ⟶ و دارای نشستِ معتبرِ
 * (منقضی‌نشده، وضعیت connected) یک سایتِ زنده. پلن/سقف را گیتِ پایین‌دست دوباره چک می‌کند.
 */
export async function listEligibleForServerDiscovery(
  conn: Database,
  limit: number = DEFAULT_DISCOVERY_BATCH,
): Promise<EligibleUser[]> {
  const liveBoards = liveBoardIds();
  if (liveBoards.length === 0 || limit <= 0) return [];

  // کاندیداها = کاربرانِ (تاگلِ سرور روشن) *و* دارای نشستِ معتبرِ یک سایتِ زنده. شرطِ نشست با
  // EXISTS داخلِ همین کوئری اعمال می‌شود — *پیش از* مرتب‌سازی/سقف — تا کاربرانِ بی‌نشست (که
  // هرگز تلاش نمی‌شوند و last_discovery_at شان NULL می‌ماند) پنجره‌ی NULLS-FIRST را اشغال و
  // بقیه را گرسنه نکنند. مرتب بر اساسِ «دیرترین تلاش‌شدن» (چرخشِ منصفانه)، سپس سقفِ دور.
  const hasLiveSession = exists(
    conn
      .select({ one: sql`1` })
      .from(boardAccounts)
      .innerJoin(sessionBlobs, eq(sessionBlobs.boardAccountId, boardAccounts.id))
      .where(
        and(
          eq(boardAccounts.userId, users.id),
          inArray(boardAccounts.board, liveBoards),
          eq(boardAccounts.status, "connected"),
          or(isNull(sessionBlobs.expiresAt), gt(sessionBlobs.expiresAt, sql`now()`)),
        ),
      ),
  );

  const candidates = await conn
    .select({ userId: users.id, plan: users.plan })
    .from(users)
    .innerJoin(
      userServerAutoApply,
      and(eq(userServerAutoApply.userId, users.id), eq(userServerAutoApply.enabled, true)),
    )
    .where(hasLiveSession)
    .orderBy(sql`${userServerAutoApply.lastDiscoveryAt} ASC NULLS FIRST`)
    .limit(Math.min(limit, MAX_DISCOVERY_CANDIDATES));

  return candidates as EligibleUser[];
}

/**
 * بدنه‌ی `fn` را زیرِ یک قفلِ مشورتیِ سراسری اجرا می‌کند تا دو تیکِ هم‌پوشانِ کشف روی هم
 * نیفتند (که کیف‌پول را برای همان آگهی‌ها دوباره شارژ می‌کرد). اگر قفل آزاد نبود، `onBusy`.
 * قفل روی یک کانکشنِ *رزروشده* گرفته و آزاد می‌شود (الزامِ pg_advisory_lockِ سطحِ نشست).
 */
export async function withDiscoveryLock<T>(fn: () => Promise<T>, onBusy: () => T): Promise<T> {
  const reserved = await client.reserve();
  try {
    const rows = await reserved`SELECT pg_try_advisory_lock(${DISCOVERY_LOCK_KEY}) AS ok`;
    const acquired = rows[0]?.ok === true;
    if (!acquired) return onBusy();
    try {
      return await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${DISCOVERY_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}

/** کدِ کوتاهِ دلیلِ ردِ گیتِ سرور (بدونِ افشای جزئیات). */
function gateReason(err: unknown): string {
  if (err instanceof ServerAutoApplyNotAllowedError) {
    const code = (err as { code?: string }).code;
    return code ? `gate:${code}` : "gate";
  }
  return "gate";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * یک دورِ کاملِ کشفِ سرور را اجرا می‌کند. برای هر کاربرِ واجدِ شرایط: گیتِ سرور → گیتِ
 * موجودیِ AI → runFilterApply(aiFilter). خطای هر کاربر ایزوله است.
 */
export async function runServerDiscovery(
  deps: ServerDiscoveryDeps = {},
): Promise<ServerDiscoverySummary> {
  const conn = deps.db ?? defaultDb;
  const listEligible = deps.listEligible ?? listEligibleForServerDiscovery;
  const assertAllowed =
    deps.assertAllowed ??
    (async (userId: string, plan: Plan) => {
      const { minScore } = await assertServerAutoApplyAllowed(userId, plan, {
        db: conn as never,
      });
      return { minScore };
    });
  const canUsePaidAi =
    deps.canUsePaidAi ?? ((userId: string) => assertCanUsePaidAi(userId, { db: conn as never }));
  const runFilter = deps.runFilter ?? ((opts) => runFilterApply(opts));
  const markAttempted = deps.markAttempted ?? defaultMarkAttempted;
  const limit = deps.limit ?? DEFAULT_DISCOVERY_BATCH;
  const budgetMs = deps.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS;
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();

  const eligible = await listEligible(conn, limit);
  const outcomes: DiscoveryUserOutcome[] = [];
  const attempted: string[] = [];
  let totalQueued = 0;
  let queuedUsers = 0;
  let skipped = 0;
  let errors = 0;
  let processed = 0;
  let deadlineHit = false;

  for (const { userId, plan } of eligible) {
    // بودجه‌ی زمان: پیش از سررسیدِ cron/تابع بایست تا اجراها روی هم نیفتند. باقی‌مانده‌ها
    // دورِ بعد (به‌لطفِ چرخشِ منصفانه) اولویت دارند.
    if (now() - startedAt >= budgetMs) {
      deadlineHit = true;
      break;
    }
    processed += 1;
    attempted.push(userId); // چرخش: هر تلاش (موفق یا رد) کاربر را به تهِ صف می‌برد.
    try {
      // گیتِ سطحِ سرور (plan/toggle/quota دوباره — belt & suspenders، fail-closed).
      let minScore: number;
      try {
        ({ minScore } = await assertAllowed(userId, plan));
      } catch (err) {
        skipped += 1;
        outcomes.push({ userId, status: "skipped", reason: gateReason(err) });
        continue;
      }

      // گیتِ موجودیِ AI — بی‌موجودی هیچ اپلای خودکاری صف نمی‌شود (auto-submit فقط با فیلترِ کیفیِ AI).
      try {
        await canUsePaidAi(userId);
      } catch {
        skipped += 1;
        outcomes.push({ userId, status: "skipped", reason: "no_ai_balance" });
        continue;
      }

      const dailyCap = applyQuotaFor(plan) ?? Number.MAX_SAFE_INTEGER;
      const report = await runFilter({
        userId,
        aiFilter: true,
        threshold: minScore,
        dailyCap,
        db: conn,
      });
      totalQueued += report.queued;
      if (report.queued > 0) queuedUsers += 1;
      outcomes.push({ userId, status: "queued", queued: report.queued });
    } catch (err) {
      errors += 1;
      outcomes.push({ userId, status: "error", reason: errMessage(err) });
    }
  }

  // چرخشِ منصفانه: مُهرِ «تلاش‌شده» را برای *همه‌ی* تلاش‌شده‌ها (نه فقط موفق‌ها) بزن، تا کاربرِ
  // همیشه-ردشده جلوی صف را قفل نکند. شکستِ این نوشتن نباید نتیجه‌ی دور را باطل کند.
  if (attempted.length > 0) {
    try {
      await markAttempted(conn, attempted);
    } catch {
      // بی‌اثر روی خروجی؛ دورِ بعد باز هم منصفانه پیش می‌رود.
    }
  }

  return {
    eligible: eligible.length,
    processed,
    deferred: eligible.length - processed,
    deadlineHit,
    queuedUsers,
    skipped,
    errors,
    totalQueued,
    outcomes,
  };
}

/** پیش‌فرضِ ثبتِ «تلاش‌شده»: last_discovery_at این کاربران را به اکنون می‌برد (یک UPDATEِ دسته‌ای). */
async function defaultMarkAttempted(conn: Database, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await conn
    .update(userServerAutoApply)
    .set({ lastDiscoveryAt: sql`now()` })
    .where(inArray(userServerAutoApply.userId, userIds));
}
