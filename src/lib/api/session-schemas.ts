import "server-only";

/**
 * اسکیماهای zod برای مسیرهای خزانه‌ی نشست (Track C — قاعده‌ی ۴، §۱۰ Max/Max+).
 *
 * تمایزِ بحرانی با board-accounts/connect و profile/import:
 *   • connect/import عمداً هر مادهٔ سری (کوکی/توکن/نشست) را رد می‌کنند (فقط متادیتا/داده).
 *   • این اندپوینت برعکس، *دقیقاً همان نشستِ خودِ کاربر* را می‌پذیرد — چون این اعتبارنامه
 *     فقط به خزانه‌ی *رمزشده‌ی همان کاربر* می‌رود و فقط برای اپلایِ خودکارِ همان کاربر
 *     (replay در نودِ Max/Max+) استفاده می‌شود. هیچ‌گاه plaintext ذخیره نمی‌شود؛ این لایه
 *     فقط شکلِ ورودی را اعتبارسنجی می‌کند و سپس crypto.encryptSession آن را رمز می‌کند.
 *
 * این فایل در مالکیتِ Track C است (نه Foundation): فقط شکلِ ورودی/سریال‌سازی را تعریف
 * می‌کند و به crypto/store دست نمی‌زند.
 */
import { z } from "zod";

/**
 * سایت‌هایی که خزانه‌ی نشست پشتیبانی می‌کند — هم‌راستا با jobBoardEnum و با board_accounts.
 * (linkedin/karboom هم در enum هستند؛ همه را می‌پذیریم تا با store.Board هم‌خوان بماند —
 * store خودش بررسی می‌کند که کاربر آن سایت را connect کرده باشد.)
 */
export const sessionBoardSchema = z.enum([
  "jobvision",
  "jobinja",
  "e-estekhdam",
  "irantalent",
  "karboom",
  "linkedin",
  "iranestekhdam",
  "divar",
  "quera",
  "remoteok",
  "weworkremotely",
  "ponisha",
  "parscoders",
  "bankestekhdam",
]);

export type SessionBoard = z.infer<typeof sessionBoardSchema>;

/**
 * یک کوکیِ ضبط‌شده (شکلِ chrome.cookies.Cookie، خلاصه‌شده). فقط فیلدهای لازم برای replay؛
 * فیلدهای ناشناخته را با `.passthrough()` نگه می‌داریم تا داده‌ی واقعیِ کوکی از دست نرود
 * (این *عمداً* اعتبارنامه است و به خزانه‌ی رمزشده‌ی خودِ کاربر می‌رود).
 */
const cookieSchema = z
  .object({
    name: z.string().min(1).max(4096),
    value: z.string().max(8192),
    domain: z.string().max(512).optional(),
    path: z.string().max(512).optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: z.string().max(32).optional(),
    expirationDate: z.number().optional(),
  })
  .passthrough();

/**
 * نگاشتِ کلید→مقدارِ localStorage/sessionStorage (هر دو رشته‌اند). محدودیتِ اندازه برای
 * جلوگیری از بلابِ غول‌آسا. این جایی است که توکنِ JWTِ جاب‌ویژن می‌نشیند (SPA؛ کوکی نیست).
 */
const storageMapSchema = z.record(z.string().max(2048), z.string().max(65536));

/**
 * بسته‌ی نشستِ ضبط‌شده‌ی کاربر برای یک سایت: کوکی‌ها + localStorage + sessionStorage.
 * حداقل یکی باید غیرخالی باشد (وگرنه چیزی برای replay نیست) — با superRefine بررسی می‌شود.
 * `userAgent` اختیاری تا replay با همان UAِ کاربر انجام شود (نه جعلِ هویت — UAِ خودِ کاربر).
 */
export const sessionBundleSchema = z
  .object({
    cookies: z.array(cookieSchema).max(500).optional(),
    localStorage: storageMapSchema.optional(),
    sessionStorage: storageMapSchema.optional(),
    /** UAِ خودِ مرورگرِ کاربر (برای هم‌خوانیِ هدرها در replay). فقط متادیتا. */
    userAgent: z.string().max(1024).optional(),
    /** زمانِ ضبط در دستگاهِ کاربر (ISO) — اختیاری، فقط برای رصد. */
    capturedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasCookies = Array.isArray(val.cookies) && val.cookies.length > 0;
    const hasLocal = val.localStorage && Object.keys(val.localStorage).length > 0;
    const hasSession =
      val.sessionStorage && Object.keys(val.sessionStorage).length > 0;
    if (!hasCookies && !hasLocal && !hasSession) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "نشستِ خالی است: حداقل یکی از cookies/localStorage/sessionStorage باید مقدار داشته باشد.",
      });
    }
  });

export type SessionBundle = z.infer<typeof sessionBundleSchema>;

/**
 * بدنه‌ی POST /api/session/refresh: سایت + بسته‌ی نشستِ خودِ کاربر.
 * `.strict()` تا فیلدِ ناشناخته (که ممکن است داده‌ی اشتباه/حساسِ نامرتبط باشد) رد شود.
 */
export const sessionRefreshBodySchema = z
  .object({
    board: sessionBoardSchema,
    session: sessionBundleSchema,
    /**
     * زمانِ انقضای تخمینیِ نشست (ISO) — اختیاری. اگر داده نشود، خزانه از پیش‌فرضِ
     * محافظه‌کارانه استفاده می‌کند تا نشستِ کهنه به needs_reauth/refresh برود.
     */
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export type SessionRefreshBody = z.infer<typeof sessionRefreshBodySchema>;

/**
 * نگاشتِ ثابتِ سایت→شکلِ نشست (متادیتا، نه مادهٔ سری) برای ستونِ NOT NULLِ session_shape.
 * جاب‌ویژن توکن‌محور (JWT در localStorage)، بقیه کوکی‌محور (بخش ۷ سند معماری).
 */
const SESSION_SHAPE_BY_BOARD: Record<SessionBoard, "cookie" | "token"> = {
  jobvision: "token",
  jobinja: "cookie",
  "e-estekhdam": "cookie",
  irantalent: "cookie",
  karboom: "cookie",
  linkedin: "cookie",
  iranestekhdam: "cookie",
  divar: "cookie",
  quera: "cookie",
  remoteok: "cookie",
  weworkremotely: "cookie",
  ponisha: "cookie",
  parscoders: "cookie",
  bankestekhdam: "cookie",
};

/**
 * شکلِ نشستِ یک سایت را برمی‌گرداند. اگر بسته فقط localStorage/sessionStorage داشته باشد
 * (بدونِ کوکی)، 'token' در نظر گرفته می‌شود (مثلِ SPAها)؛ وگرنه از نگاشتِ سایت پیروی می‌کند.
 */
export function resolveSessionShape(
  board: SessionBoard,
  bundle: SessionBundle,
): "cookie" | "token" {
  const hasCookies = Array.isArray(bundle.cookies) && bundle.cookies.length > 0;
  if (!hasCookies) return "token";
  return SESSION_SHAPE_BY_BOARD[board];
}

/**
 * یک بسته‌ی نشست را به رشته‌ی JSONِ پایدار سریال می‌کند تا crypto.encryptSession آن را
 * رمز کند. این رشته plaintextِ نشست است و *هرگز نباید لاگ/ذخیره‌ی خام شود* — صرفاً به
 * encryptSession پاس می‌شود و خروجیِ رمزشده ذخیره می‌گردد.
 */
export function serializeSessionBundle(bundle: SessionBundle): string {
  return JSON.stringify(bundle);
}
