import "server-only";

/**
 * هسته‌ی گیتِ «اپلای خودکار» (server-only) — قاعده‌ی ۱ (CONTEXT/§۱۰).
 *
 * هیچ‌چیز به‌صورت خودکار اپلای نمی‌شود مگر این سه گارد با هم برقرار باشند:
 *   ۱) **تاگلِ رضایت روشن** (user_auto_apply.enabled = true) — رضایتِ صریحِ کاربر.
 *   ۲) **زیرِ سقفِ روزانه** — Free = ۱۰۰/روز؛ پلن‌های پولی نامحدود (از apply-quota/plans).
 *   ۳) **آستانه‌ی امتیازِ تطبیق** — هر آیتمِ اپلای باید score ≥ minScore باشد (پیش‌فرض ۰٫۷).
 *
 * این لایه گاردها را *جدا از* مسیرِ افزونه نگه می‌دارد تا چوک‌پوینتِ claim فقط آن را صدا
 * بزند. هر تلاش/تصمیمِ اپلایِ خودکار یک ردیفِ audit_events می‌نویسد (recordAutoApplyAudit).
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند (db/readPlan/...) تا بدونِ DB/شبکه‌ی زنده تست شوند.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  auditEvents,
  userAutoApply,
  type Plan,
  type UserAutoApplyRow,
} from "@/db/schema";
import {
  assertApplyQuota,
  type ApplyQuotaStatus,
} from "@/lib/billing/apply-quota";

/** آستانه‌ی پیش‌فرضِ امتیازِ تطبیق اگر کاربر تنظیمی نداشته باشد (هم‌راستا با schema default). */
export const DEFAULT_AUTO_APPLY_MIN_SCORE = 0.7;

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد. */
export type AutoApplyDb = typeof defaultDb;

/** تنظیماتِ مؤثرِ اپلای خودکارِ یک کاربر. */
export interface AutoApplySettings {
  enabled: boolean;
  /** آستانه‌ی امتیازِ تطبیق (۰..۱). */
  minScore: number;
}

/** وابستگی‌های قابلِ تزریقِ خواندنِ تنظیمات — برای تستِ بدونِ DB. */
export interface AutoApplySettingsDeps {
  db?: AutoApplyDb;
  /** خواننده‌ی ردیفِ تنظیمات (پیش‌فرض از جدولِ user_auto_apply). */
  readRow?: (userId: string) => Promise<UserAutoApplyRow | null>;
}

/** ردیفِ تنظیماتِ اپلای خودکارِ این کاربر را می‌خواند (یا null اگر هرگز ست نشده). */
async function readAutoApplyRow(
  userId: string,
  db: AutoApplyDb,
): Promise<UserAutoApplyRow | null> {
  const [row] = await db
    .select()
    .from(userAutoApply)
    .where(eq(userAutoApply.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * تنظیماتِ مؤثرِ اپلای خودکارِ کاربر را برمی‌گرداند.
 *
 * پیش‌فرضِ محتاطانه (وقتی ردیفی وجود ندارد): enabled=false (هیچ اپلای خودکاری) و
 * minScore=۰٫۷. این تضمین می‌کند کاربری که هرگز تاگل را روشن نکرده، هرگز اپلایِ خودکار
 * نمی‌گیرد — حتی اگر جای دیگری اشتباه شود.
 */
export async function getAutoApplySettings(
  userId: string,
  deps: AutoApplySettingsDeps = {},
): Promise<AutoApplySettings> {
  const db = deps.db ?? defaultDb;
  const read = deps.readRow ?? ((id: string) => readAutoApplyRow(id, db));
  const row = await read(userId);
  if (!row) {
    return { enabled: false, minScore: DEFAULT_AUTO_APPLY_MIN_SCORE };
  }
  return { enabled: row.enabled, minScore: row.minScore };
}

/** آیا تاگلِ اپلای خودکارِ این کاربر روشن است؟ (راهِ سریعِ گارد). */
export async function isAutoApplyEnabled(
  userId: string,
  deps: AutoApplySettingsDeps = {},
): Promise<boolean> {
  const { enabled } = await getAutoApplySettings(userId, deps);
  return enabled;
}

/**
 * تاگلِ اپلای خودکار را روشن/خاموش می‌کند (و در صورتِ تعیین، آستانه را به‌روزرسانی می‌کند).
 * یک ردیفِ user_auto_apply را upsert می‌کند (یکتا روی userId). صدازننده (route) باید
 * رویدادِ ممیزیِ متناظر (auto_apply_enabled/disabled) را با recordAutoApplyAudit بنویسد.
 *
 * @returns تنظیماتِ مؤثرِ پس از تغییر.
 */
export async function setAutoApplyEnabled(
  userId: string,
  enabled: boolean,
  opts: { minScore?: number; db?: AutoApplyDb } = {},
): Promise<AutoApplySettings> {
  const db = opts.db ?? defaultDb;
  const now = new Date();
  const clampedScore =
    opts.minScore === undefined ? undefined : clampScore(opts.minScore);

  const [row] = await db
    .insert(userAutoApply)
    .values({
      userId,
      enabled,
      ...(clampedScore === undefined ? {} : { minScore: clampedScore }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userAutoApply.userId,
      set: {
        enabled,
        ...(clampedScore === undefined ? {} : { minScore: clampedScore }),
        updatedAt: now,
      },
    })
    .returning();

  return { enabled: row.enabled, minScore: row.minScore };
}

/** امتیاز را به بازه‌ی معتبرِ [۰، ۱] مهار می‌کند (دفاع در برابرِ ورودیِ خارج از بازه). */
function clampScore(score: number): number {
  if (Number.isNaN(score)) return DEFAULT_AUTO_APPLY_MIN_SCORE;
  return Math.min(1, Math.max(0, score));
}

/* ─────────────────────────  گیتِ مرکزیِ چوک‌پوینت  ──────────────────────── */

/** کدهای پایدارِ ردِ گیتِ اپلای خودکار — برای تصمیمِ دقیقِ فراخواننده/UI. */
export type AutoApplyDenialCode = "disabled" | "quota_exceeded";

/**
 * خطای typed: گیتِ اپلای خودکار اجازه نداد. چوک‌پوینتِ claim با گرفتنِ این خطا باید
 * صفِ خالی برگرداند (نه آیتمِ اپلای) — هیچ اپلایِ خودکاری رخ نمی‌دهد.
 */
export class AutoApplyNotAllowedError extends Error {
  readonly code: AutoApplyDenialCode;
  /** در حالتِ quota_exceeded: سقف/مصرفِ امروز (برای پیام). */
  readonly usedToday?: number;
  readonly limit?: number | null;

  constructor(args: {
    code: AutoApplyDenialCode;
    message?: string;
    usedToday?: number;
    limit?: number | null;
  }) {
    super(
      args.message ??
        (args.code === "disabled"
          ? "اپلای خودکار برای این کاربر روشن نیست (تاگلِ رضایت خاموش است)."
          : "به سقفِ اپلای روزانه رسیده‌اید؛ اپلای خودکار تا فردا متوقف است."),
    );
    this.name = "AutoApplyNotAllowedError";
    this.code = args.code;
    this.usedToday = args.usedToday;
    this.limit = args.limit;
  }
}

/** نتیجه‌ی موفقِ گیت — آستانه‌ی مؤثر + وضعیتِ سهمیه (برای فیلترِ بالای آستانه در صف). */
export interface AutoApplyAllowance {
  /** آستانه‌ی مؤثرِ امتیازِ تطبیق که آیتم‌های صف باید از آن بگذرند. */
  minScore: number;
  /** وضعیتِ سهمیه‌ی روزانه (سقف/مصرف/باقی‌مانده) در لحظه‌ی گیت. */
  quota: ApplyQuotaStatus;
}

/**
 * وابستگی‌های قابلِ تزریقِ گیتِ چوک‌پوینت. `db` (کلاینتِ کاملِ Drizzle) هم برای خواندنِ
 * تنظیمات و هم برای شمارشِ سهمیه کافی است (ApplyQuotaDb فقط به `select` نیاز دارد، که
 * کلاینتِ کامل آن را دارد)؛ پس یک هندلِ مشترک کافی است.
 */
export interface AssertAutoApplyDeps {
  db?: AutoApplyDb;
  /** خواننده‌ی ردیفِ تنظیماتِ اپلای خودکار (پیش‌فرض از DB). */
  readRow?: (userId: string) => Promise<UserAutoApplyRow | null>;
  /** خواننده‌ی شمارشِ اپلای‌های امروز (پیش‌فرض countAppliesToday). */
  readCountToday?: (userId: string) => Promise<number>;
}

/**
 * گیتِ مرکزی که چوک‌پوینتِ claim پیش از برگرداندنِ آیتم‌های اپلای صدا می‌زند.
 *
 * گاردها (به‌ترتیب، fail-closed):
 *   ۱) تاگل خاموش → AutoApplyNotAllowedError('disabled').
 *   ۲) سقفِ روزانه پر (assertApplyQuota با پلن) → AutoApplyNotAllowedError('quota_exceeded').
 *   ۳) در غیرِ این صورت → آستانه‌ی مؤثر + وضعیتِ سهمیه برگردانده می‌شود تا فراخواننده فقط
 *      آیتم‌های score ≥ minScore و در محدوده‌ی سهمیه را بدهد.
 *
 * @param userId کاربری که آیتم برایش claim می‌شود (همیشه از نشست، نه از بدنه — قاعده‌ی ۴).
 * @param plan   پلنِ کاربر (برای سقفِ روزانه از plans.ts).
 */
export async function assertAutoApplyAllowed(
  userId: string,
  plan: Plan,
  deps: AssertAutoApplyDeps = {},
): Promise<AutoApplyAllowance> {
  // ۱) تاگلِ رضایت.
  const settings = await getAutoApplySettings(userId, deps);
  if (!settings.enabled) {
    throw new AutoApplyNotAllowedError({ code: "disabled" });
  }

  // ۲) سقفِ روزانه (پلن‌های پولی نامحدودند و کوئریِ شمارش نمی‌زنند).
  let quota: ApplyQuotaStatus;
  try {
    quota = await assertApplyQuota(userId, plan, deps);
  } catch (err) {
    // ApplyQuotaError → کدِ گیتِ quota_exceeded (با حفظِ سقف/مصرف).
    const e = err as { usedToday?: number; limit?: number };
    throw new AutoApplyNotAllowedError({
      code: "quota_exceeded",
      usedToday: e.usedToday,
      limit: e.limit,
    });
  }

  // ۳) مجاز — آستانه‌ی مؤثر را برگردان.
  return { minScore: settings.minScore, quota };
}

/* ──────────────────────────  ممیزی (audit trail)  ──────────────────────── */

/** نوعِ رویدادِ اپلای خودکار — زیرمجموعه‌ی auditEventTypeEnum. */
export type AutoApplyAuditEvent =
  | "auto_apply_enabled"
  | "auto_apply_disabled"
  | "auto_apply_attempted"
  | "auto_apply_skipped";

/** ورودیِ نوشتنِ یک ردیفِ ممیزیِ اپلای خودکار. */
export interface AutoApplyAuditInput {
  userId: string;
  eventType: AutoApplyAuditEvent;
  /** متادیتای رویداد (taskId, score, minScore, reason, board, ...). هرگز نشست/راز نباشد. */
  metadata?: Record<string, unknown>;
  /** در صورتِ مرتبط، شناسه‌ی application (برای پیوندِ نتیجه). */
  applicationId?: string;
  /** در صورتِ مرتبط، شناسه‌ی board_account. */
  boardAccountId?: string;
}

/**
 * یک ردیفِ audit_events برای هر تلاش/تصمیمِ اپلای خودکار می‌نویسد (append-only، قاعده‌ی ۱).
 *
 * این تابع هرگز نشست/کوکی/توکن/راز را در metadata نمی‌نویسد — فقط متادیتای تصمیم. صدازننده
 * مسئولِ تمیزبودنِ metadata است. هرگز throw را به فراخواننده‌ی اصلی پراکنده نمی‌کنیم؟ — خیر،
 * شکستِ ممیزی باید دیده شود؛ پس throw می‌کند تا مسیرِ صدازننده آن را مدیریت کند.
 */
export async function recordAutoApplyAudit(
  input: AutoApplyAuditInput,
  conn: AutoApplyDb = defaultDb,
): Promise<void> {
  await conn.insert(auditEvents).values({
    userId: input.userId,
    eventType: input.eventType,
    applicationId: input.applicationId ?? null,
    boardAccountId: input.boardAccountId ?? null,
    metadata: input.metadata ?? null,
  });
}
