import "server-only";

/**
 * صف وظیفه‌ی مبتنی بر Postgres روی جدول `tasks`.
 *
 * چرا Postgres و نه Redis؟ بخش ۸ سند معماری: «با `SELECT … FOR UPDATE SKIP LOCKED`
 * شروع کن (بدون زیرساخت اضافه)؛ در صورت نیاز به حجم بالا به Redis/BullMQ ارتقا بده.»
 *
 * تضمین‌های این صف:
 *   • idempotent — هر `idempotencyKey` فقط یک‌بار وارد صف می‌شود
 *     (مثلاً `apply:${matchId}`)؛ تلاش دوم همان ردیف موجود را برمی‌گرداند.
 *   • claim اتمیک و امن در برابر رقابت (race-safe) — چند مصرف‌کننده‌ی همزمان هرگز
 *     یک وظیفه را دوبار برنمی‌دارند، چون از `FOR UPDATE SKIP LOCKED` استفاده می‌کنیم
 *     (پایین «همزمانی» را ببینید).
 *   • backoff نمایی روی شکست + سقف تلاش → بعد از `maxAttempts` ردیف `dead` می‌شود.
 *
 * ── همزمانی (SKIP LOCKED) ─────────────────────────────────────────────────
 * `claim` یک دستور واحد است: زیرپرسش، ردیف‌های آماده را با
 * `FOR UPDATE SKIP LOCKED` قفل می‌کند و سپس همان ردیف‌ها در یک `UPDATE … RETURNING`
 * به وضعیت `leased` می‌روند. اگر کارگرِ B هم‌زمان اجرا شود، ردیف‌های قفل‌شده توسط A
 * را *رد* می‌کند (نه اینکه پشتشان منتظر بماند) و سراغ ردیف‌های بعدی می‌رود. در نتیجه:
 *   • هیچ دو کارگری یک وظیفه را برنمی‌دارند (بدون double-dispatch).
 *   • هیچ کارگری پشت قفل کارگر دیگر بلاک نمی‌شود (توان عملیاتی بالا).
 * چون کل claim یک statement است، نیازی به تراکنش بیرونی نیست؛ خود Postgres آن را
 * اتمیک اجرا می‌کند.
 */
import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import type { Task } from "@/db/schema";

/* ──────────────────────────────  انواع عمومی  ───────────────────────────── */

/**
 * هندل کمینه‌ای که صف به آن نیاز دارد. کلاینت واقعی Drizzle این را ارضا می‌کند؛
 * در تست یک mock سبک تزریق می‌شود (بدون DB زنده).
 */
export interface QueueDb {
  execute<TRow extends Record<string, unknown> = Record<string, unknown>>(
    query: ReturnType<typeof sql>,
  ): Promise<Iterable<TRow> & ArrayLike<TRow>>;
}

/** ورودی enqueue — فیلدهای لازم برای ساختن یک ردیف صف. */
export interface EnqueueInput {
  /** کلید ایدمپوتنسی یکتا، مثلاً `apply:${matchId}`. */
  idempotencyKey: string;
  matchId: string;
  /** board_account که نشستش برای این اپلای استفاده می‌شود (اختیاری). */
  sessionRef?: string | null;
  payload?: Record<string, unknown>;
  /** سقف تلاش (پیش‌فرض ۵ — هم‌راستا با اسکیما). */
  maxAttempts?: number;
  /** زودترین زمان مجاز اجرا (jitter/throttle)؛ پیش‌فرض همین حالا. */
  runAfter?: Date;
}

/** پیکربندی backoff شکست — قابل override در تست. */
export interface BackoffConfig {
  /** پایه‌ی تأخیر بر حسب میلی‌ثانیه (پیش‌فرض ۳۰ ثانیه). */
  baseMs: number;
  /** سقف تأخیر بر حسب میلی‌ثانیه (پیش‌فرض ۱ ساعت). */
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 30_000,
  maxMs: 60 * 60_000,
};

/* ─────────────────────────────  کمک‌تابع‌ها  ────────────────────────────── */

/**
 * تأخیر backoff نمایی برای تلاش n اُم (۱-مبنا).
 * attempt=1 → base، attempt=2 → base*2، … با سقف maxMs.
 * (jitter را عمداً اینجا اضافه نمی‌کنیم تا تابع خالص و قابل‌تست بماند؛ زمان‌بند
 *  لایه‌ی بالاتر می‌تواند jitter بدهد.)
 */
export function backoffMs(attempt: number, cfg: BackoffConfig = DEFAULT_BACKOFF): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exp = cfg.baseMs * 2 ** (safeAttempt - 1);
  return Math.min(exp, cfg.maxMs);
}

/** اولین ردیف از نتیجه‌ی execute را برمی‌گرداند (یا undefined). */
function firstRow<T>(rows: Iterable<T> & ArrayLike<T>): T | undefined {
  return rows.length > 0 ? rows[0] : undefined;
}

/* ───────────────────────────────  عملیات  ──────────────────────────────── */

/**
 * یک وظیفه را به‌صورت idempotent وارد صف می‌کند.
 *
 * از `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` استفاده می‌کند.
 * اگر ردیف از قبل وجود داشته باشد، RETURNING چیزی برنمی‌گرداند؛ آن‌گاه ردیف موجود را
 * با یک SELECT می‌خوانیم و همان را برمی‌گردانیم. در نتیجه فراخوانی دوباره با همان
 * کلید، هرگز ردیف دوم نمی‌سازد و همیشه همان وظیفه‌ی واحد را پس می‌دهد.
 *
 * @returns ردیف صف (تازه‌ساخته یا از‌پیش‌موجود) و اینکه آیا تازه ساخته شد.
 */
export async function enqueue(
  input: EnqueueInput,
  conn: QueueDb = defaultDb as unknown as QueueDb,
): Promise<{ task: Task; created: boolean }> {
  const payload = input.payload ?? {};
  const maxAttempts = input.maxAttempts ?? 5;
  const runAfter = input.runAfter ?? new Date();

  // نکته (Integrate/baremetal): زمان را به‌صورت رشته‌ی ISO با cast صریحِ ::timestamptz
  // می‌فرستیم. درایور `postgres` در مسیرِ bindِ خامِ prepared-statement، یک شیء Date را
  // برای پارامترِ timestamptz به‌صورت خودکار سریالایز نمی‌کند و خطای ERR_INVALID_ARG_TYPE
  // می‌دهد؛ ISO string + cast این مشکل را بدون تغییرِ رفتار حل می‌کند.
  const inserted = await conn.execute<Task>(sql`
    INSERT INTO tasks
      (idempotency_key, match_id, session_ref, payload, max_attempts, run_after)
    VALUES (
      ${input.idempotencyKey},
      ${input.matchId},
      ${input.sessionRef ?? null},
      ${JSON.stringify(payload)}::jsonb,
      ${maxAttempts},
      ${runAfter.toISOString()}::timestamptz
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `);

  const createdRow = firstRow(inserted);
  if (createdRow) {
    return { task: createdRow, created: true };
  }

  // برخورد رخ داد → ردیف موجود با همین کلید را برگردان.
  const existing = await conn.execute<Task>(sql`
    SELECT * FROM tasks WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1
  `);
  const existingRow = firstRow(existing);
  if (!existingRow) {
    // نباید رخ دهد (یا insert موفق بود یا conflict)؛ محافظ در برابر حالت نادر.
    throw new Error(
      `enqueue: نه ردیف تازه ساخته شد نه ردیف موجود یافت شد برای کلید ${input.idempotencyKey}`,
    );
  }
  return { task: existingRow, created: false };
}

/**
 * تا `limit` وظیفه‌ی آماده را به‌صورت اتمیک برای `workerId` اجاره (lease) می‌کند.
 *
 * «آماده» یعنی `status='pending'` و `run_after <= now()`. ردیف‌های انتخاب‌شده با
 * `FOR UPDATE SKIP LOCKED` قفل می‌شوند تا مصرف‌کننده‌های همزمان روی هم نیفتند، سپس
 * در همان statement به `leased` می‌روند، `attempts` یک واحد زیاد می‌شود و
 * `leased_by`/`leased_at` پر می‌شوند. ردیف‌های به‌روزشده RETURNING می‌شوند.
 *
 * @param workerId شناسه‌ی نود کارگر (worker_nodes.id). برای مصرف‌کننده‌ی غیرکارگری
 *   می‌تواند null باشد (مثلاً افزونه‌ی مرورگر در tier استاندارد).
 */
export async function claim(
  workerId: string | null,
  limit: number,
  conn: QueueDb = defaultDb as unknown as QueueDb,
): Promise<Task[]> {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  const rows = await conn.execute<Task>(sql`
    UPDATE tasks AS t
    SET
      status = 'leased',
      attempts = t.attempts + 1,
      leased_by = ${workerId},
      leased_at = now(),
      updated_at = now()
    WHERE t.id IN (
      SELECT id FROM tasks
      WHERE status = 'pending'
        AND run_after <= now()
      ORDER BY run_after ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${safeLimit}
    )
    RETURNING t.*
  `);

  return Array.from(rows);
}

/**
 * یک وظیفه را موفق علامت می‌زند و قفلش را آزاد می‌کند.
 * `payload` با نتیجه‌ی برگشتی merge می‌شود تا اثبات/خروجی اجرا حفظ شود.
 *
 * نگهبانِ اجاره: فقط وظیفه‌ای که هنوز `leased` است را نهایی می‌کند. اگر ردیفی برنگردد
 * (undefined) یعنی وظیفه قبلاً نهایی شده یا توسط مصرف‌کننده‌ی دیگری دوباره اجاره شده؛
 * مصرف‌کننده‌ی کهنه نباید آن را خراب کند (تضمینِ effectively-once).
 */
export async function complete(
  taskId: string,
  result: Record<string, unknown> = {},
  conn: QueueDb = defaultDb as unknown as QueueDb,
): Promise<Task | undefined> {
  const rows = await conn.execute<Task>(sql`
    UPDATE tasks
    SET
      status = 'succeeded',
      last_error = NULL,
      payload = payload || ${JSON.stringify(result)}::jsonb,
      leased_by = NULL,
      leased_at = NULL,
      updated_at = now()
    WHERE id = ${taskId} AND status = 'leased'::task_status
    RETURNING *
  `);
  return firstRow(rows);
}

/**
 * یک وظیفه را شکست‌خورده ثبت می‌کند.
 *
 * منطق: `attempts` در زمان `claim` قبلاً افزایش یافته است. اگر
 * `attempts >= max_attempts` باشد ردیف به `dead` می‌رود (دیگر retry نمی‌شود)؛ در غیر
 * این صورت به `pending` بازمی‌گردد با `run_after = now() + backoff(attempts)` تا با
 * تأخیر نمایی دوباره تلاش شود. کل تصمیم در یک statement سمت DB گرفته می‌شود تا اتمیک
 * بماند (بدون read-modify-write در اپ).
 */
export async function fail(
  taskId: string,
  error: string,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
  conn: QueueDb = defaultDb as unknown as QueueDb,
): Promise<Task | undefined> {
  const errText = error.slice(0, 4000); // محافظت در برابر خطاهای خیلی بلند.
  const rows = await conn.execute<Task>(sql`
    UPDATE tasks
    SET
      status = CASE WHEN attempts >= max_attempts THEN 'dead'::task_status
                    ELSE 'pending'::task_status END,
      last_error = ${errText},
      run_after = CASE
        WHEN attempts >= max_attempts THEN run_after
        ELSE now() + (LEAST(
          ${cfg.baseMs} * power(2, GREATEST(attempts - 1, 0)),
          ${cfg.maxMs}
        ) * interval '1 millisecond')
      END,
      leased_by = NULL,
      leased_at = NULL,
      updated_at = now()
    WHERE id = ${taskId} AND status = 'leased'::task_status
    RETURNING *
  `);
  return firstRow(rows);
}
