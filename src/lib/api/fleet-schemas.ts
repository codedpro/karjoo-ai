import "server-only";

/**
 * اسکیماهای zod برای مسیرهای ناوگانِ اپلای (Track A) — رو-به-نود و ادمین.
 *
 * هر ورودیِ خارجی (بدنه/پارامتر) پیش از لمسِ هسته‌ی fleet اینجا اعتبارسنجی می‌شود. این
 * فایل جدا از `schemas.ts`/`extension-schemas.ts` است تا مالکیتِ فایل‌ها تداخل نکند.
 *
 * قاعده‌ی امنیت: هیچ اسکیمای رو-به-نودی `nodeId` نمی‌گیرد — نودِ هدف فقط از اعتبارنامه‌ی
 * احرازشده می‌آید (نه از بدنه‌ی قابلِ جعل). همین‌طور `result`/`proof` با `.strict()`های
 * مرتبط از پذیرشِ مادهٔ سری (نشست/کوکی/توکن) جلوگیری می‌کنند.
 */
import { z } from "zod";

/* ───────────────────────────  POST /api/fleet/enroll  ───────────────────── */

/**
 * بدنه‌ی ثبت‌نامِ نود. `.strict()` تا فیلدِ ناشناخته رد شود. enrollmentToken رازِ
 * یک‌بارمصرف است (هرگز لاگ نمی‌شود)؛ nodeKey شناسه‌ی پایدارِ خودِ نود (مبنای upsert).
 */
export const fleetEnrollBodySchema = z
  .object({
    /** رازِ یک‌بارمصرفِ ثبت‌نام (در برابرِ KARJOO_FLEET_ENROLLMENT_TOKEN سنجیده می‌شود). */
    enrollmentToken: z.string().min(1, "enrollmentToken الزامی است").max(512),
    /** شناسه‌ی پایدارِ نود (از پیکربندیِ خودِ نود). */
    nodeKey: z.string().trim().min(1, "nodeKey الزامی است").max(200),
    /** کلاسِ IP/منطقه — مثلاً «IR-residential». اختیاری. */
    region: z.string().trim().min(1).max(120).optional(),
    /** نسخه‌ی عاملِ نود. اختیاری. */
    agentVersion: z.string().trim().min(1).max(120).optional(),
    /** IPِ گزارش‌شده‌ی نود. اختیاری. */
    ipAddress: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type FleetEnrollBody = z.infer<typeof fleetEnrollBodySchema>;

/* ─────────────────────────  POST /api/fleet/heartbeat  ──────────────────── */

/** سلامتِ گزارش‌شده‌ی نود — هم‌راستا با workerHealthEnum. */
export const fleetHealthSchema = z.enum(["online", "degraded", "offline"]);

/**
 * بدنه‌ی heartbeat — همه اختیاری (نود می‌تواند فقط health بفرستد). `.strict()`.
 * نودِ هدف از اعتبارنامه می‌آید، نه از بدنه (هیچ nodeId اینجا نیست).
 */
export const fleetHeartbeatBodySchema = z
  .object({
    health: fleetHealthSchema.optional(),
    agentVersion: z.string().trim().min(1).max(120).optional(),
    ipAddress: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type FleetHeartbeatBody = z.infer<typeof fleetHeartbeatBodySchema>;

/* ───────────────────────────  POST /api/fleet/claim  ────────────────────── */

/**
 * بدنه‌ی claim — اختیاری. `limit` سقفِ کلِ کارهای برگشتی است (۱..۲۵، پیش‌فرض ۵).
 * `.strict()` تا فیلدِ ناشناخته رد شود. نودِ هدف از اعتبارنامه می‌آید.
 */
export const fleetClaimBodySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(25).default(5),
  })
  .strict();

export type FleetClaimBody = z.infer<typeof fleetClaimBodySchema>;

/* ──────────────────────────  POST /api/fleet/result  ────────────────────── */

/**
 * بدنه‌ی ثبتِ نتیجه‌ی یک کار توسطِ نود. `.strict()` در سطحِ بالا تا فیلدِ ناشناخته
 * (تلاش برای فرستادنِ نشست/کوکی) رد شود. `userId`/`taskId` از همان FleetJobی می‌آیند که
 * سرور پیش‌تر به همین نود داده بود؛ مالکیتِ نهایی در recordFleetResult (مقید به userId)
 * دوباره سنجیده می‌شود (task باید به این کاربر تعلق داشته باشد، وگرنه ۴۰۴/۴۰۹).
 */
export const fleetResultBodySchema = z
  .object({
    taskId: z.string().uuid("taskId باید UUID معتبر باشد"),
    userId: z.string().uuid("userId باید UUID معتبر باشد"),
    status: z.enum(["submitted", "skipped", "failed"]),
    externalRef: z.string().trim().min(1).max(512).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    /** اثباتِ ساخت‌یافته (پاسخِ سایت) — هرگز نشست/کوکی/توکن. شیء آزاد ولی محدود. */
    proof: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type FleetResultBody = z.infer<typeof fleetResultBodySchema>;

/* ────────────────────  POST /api/fleet/commands/[id]/ack  ───────────────── */

/** پارامترِ مسیرِ ack — شناسه‌ی فرمان (UUID). */
export const commandIdParamSchema = z.object({
  id: z.string().uuid("id باید UUID معتبر باشد"),
});

/**
 * بدنه‌ی ackِ یک فرمان. status یکی از acked/done/failed؛ result خروجیِ اجرای نود
 * (stdout/exitCode/error) — اختیاری. `.strict()`.
 */
export const fleetCommandAckBodySchema = z
  .object({
    status: z.enum(["acked", "done", "failed"]),
    result: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type FleetCommandAckBody = z.infer<typeof fleetCommandAckBodySchema>;

/* ───────────────────────  POST /api/admin/fleet/assign  ─────────────────── */

/**
 * بدنه‌ی تخصیصِ نود به کاربر (ادمین). `.strict()`. سقفِ IPِ پلن در hسته‌ی
 * assignNodeToUser اعمال می‌شود (این مسیر فقط ورودی را اعتبارسنجی می‌کند).
 */
export const adminAssignBodySchema = z
  .object({
    userId: z.string().uuid("userId باید UUID معتبر باشد"),
    nodeId: z.string().uuid("nodeId باید UUID معتبر باشد"),
  })
  .strict();

export type AdminAssignBody = z.infer<typeof adminAssignBodySchema>;

/* ──────────────────────  POST /api/admin/fleet/command  ─────────────────── */

/**
 * بدنه‌ی صدورِ فرمان به یک نود (ادمین). command یکی از update/restart؛ payload اختیاری
 * (جزئیاتِ فرمان مثلِ targetVersion — هرگز راز). `.strict()`.
 */
export const adminCommandBodySchema = z
  .object({
    nodeId: z.string().uuid("nodeId باید UUID معتبر باشد"),
    command: z.enum(["update", "restart"]),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AdminCommandBody = z.infer<typeof adminCommandBodySchema>;
