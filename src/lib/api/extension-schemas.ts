import "server-only";

/**
 * اسکیماهای zod برای مسیرهای رو-به-افزونه و board-accounts و apply-queue.
 *
 * هر ورودیِ خارجی پیش از لمسِ DB/منطق اینجا اعتبارسنجی می‌شود. این فایل جدا از
 * `schemas.ts`ِ فاز ۱ است تا مالکیتِ فایل‌ها تداخل نکند (هر مرحله فقط فایل‌های خودش).
 *
 * قاعده‌ی ایمنیِ ۱ (CONTEXT): اندپوینتِ connect فقط متادیتا ذخیره می‌کند. اسکیمای
 * connect عمداً `.strict()` است تا هر فیلدِ ناشناخته (کوکی/توکن/پسورد) رد شود و
 * هرگز مادهٔ سری به سرور منتقل نشود.
 */
import { z } from "zod";

/**
 * سایت‌های کاریابی پشتیبانی‌شده — هم‌راستا با jobBoardEnum/JobBoardId.
 * irantalent باید حاضر باشد چون افزونه آن را connect می‌کند (هم‌چون import/session
 * که از قبل irantalent را می‌پذیرند و jobBoardEnumِ پایه)؛ نبودش باعثِ ۴۰۰ روی
 * connectِ irantalent می‌شد (seamِ شکسته).
 */
export const jobBoardSchema = z.enum([
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
]);

/* ───────────────────────────  POST /api/extension/link  ─────────────────── */

/**
 * بدنه‌ی redeemِ کدِ جفت‌سازی — هندآفِ «بدون ورودِ دوم» (قاعده‌ی ۵).
 * `.strict()` تا فیلدِ اضافی (مثلاً تلاش برای فرستادنِ توکنِ خام) رد شود.
 */
export const extensionLinkBodySchema = z
  .object({
    /** کدِ جفت‌سازیِ یک‌بارمصرف که در وب ساخته و به افزونه منتقل شده. */
    pairingCode: z.string().min(1, "pairingCode الزامی است").max(512),
  })
  .strict();

export type ExtensionLinkBody = z.infer<typeof extensionLinkBodySchema>;

/* ────────────────────  POST /api/board-accounts/connect  ────────────────── */

/**
 * بدنه‌ی اتصالِ حسابِ سایت — **فقط متادیتا** (قاعده‌ی ایمنیِ ۱).
 * `.strict()` بحرانی است: هر فیلدِ ناشناخته (cookie/token/password/credential)
 * باعثِ شکستِ اعتبارسنجی (۴۰۰) می‌شود؛ بنابراین مادهٔ سری هرگز پذیرفته نمی‌شود.
 */
export const boardConnectBodySchema = z
  .object({
    /** سایتی که حساب کاربر در آن «متصل» اعلام می‌شود. */
    board: jobBoardSchema,
    /** برچسبِ نمایشیِ اختیاریِ حساب (مثلاً نام کاربری در آن سایت). فقط متادیتا. */
    accountLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type BoardConnectBody = z.infer<typeof boardConnectBodySchema>;

/* ─────────────────────────  POST /api/apply-queue/claim  ────────────────── */

/**
 * بدنه‌ی claimِ صفِ اپلای توسطِ افزونه. هیچ فیلدِ الزامی ندارد؛ فقط سقفِ اختیاریِ
 * تعدادِ آیتمِ برگشتی. کاربر از `userId`ِ نشستِ احرازشده می‌آید، نه از بدنه.
 */
export const applyQueueClaimBodySchema = z
  .object({
    /** حداکثر تعدادِ آیتمِ pending که برگردانده شود (۱..۲۵، پیش‌فرض ۵). */
    limit: z.coerce.number().int().min(1).max(25).default(5),
  })
  .strict()
  .default({ limit: 5 });

export type ApplyQueueClaimBody = z.infer<typeof applyQueueClaimBodySchema>;

/* ──────────────────  POST /api/apply-queue/:id/result  ──────────────────── */

/**
 * بدنه‌ی ثبتِ نتیجه‌ی یک اپلایِ تأییدشده توسطِ کاربر در افزونه.
 *
 * قاعده‌ی ۲ (CONTEXT): هر ارسال به یک «اقدامِ تأییدِ صریحِ کاربر» در UI افزونه نیاز
 * دارد. این اندپوینت فقط نتیجه‌ی یک اقدامِ تأییدشده را ثبت می‌کند؛ هرگز خودش صف را
 * بدونِ گزارشِ افزونه جلو نمی‌برد.
 */
export const applyQueueResultBodySchema = z
  .object({
    /**
     * نتیجه‌ی ارسالِ تأییدشده. 'submitted' = کاربر تأیید و افزونه ارسال کرد؛
     * 'skipped' = کاربر رد کرد؛ 'failed' = اقدامِ تأییدشده در ارسال خطا خورد.
     */
    status: z.enum(["submitted", "skipped", "failed"]),
    /** ارجاعِ خارجیِ برگشتی از سایت (شناسه‌ی درخواست)، در صورت وجود. */
    externalRef: z.string().max(512).optional(),
    /** دلیل/یادداشت (برای skipped/failed). */
    reason: z.string().max(2000).optional(),
    /** اثباتِ ارسالِ ساخت‌یافته (پاسخِ API/خلاصه). بدونِ مادهٔ سری. */
    proof: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ApplyQueueResultBody = z.infer<typeof applyQueueResultBodySchema>;

/** اسکیمای پارامترِ مسیرِ `:id` — UUIDِ task. */
export const taskIdParamSchema = z.object({
  id: z.string().uuid("id باید UUID معتبر باشد"),
});
