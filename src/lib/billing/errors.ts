/**
 * خطاهای typed لایه‌ی بیلینگ — تا فراخواننده (route/orchestrator) بتواند دقیق تصمیم
 * بگیرد و پیامِ درست به کاربر بدهد (مثلاً «شارژ لازم است» در برابر «مدل ناشناخته»).
 *
 * این فایل عمداً «server-only» نیست: فقط تعریفِ کلاسِ خطاست (بدونِ راز یا I/O)، تا هم
 * در سرور و هم در تستِ واحد بدونِ اصطکاک قابلِ استفاده باشد.
 */
import type { Plan } from "@/db/schema";

/** کدهای پایدارِ خطای بیلینگ — برای مدیریتِ دقیق در فراخواننده. */
export type BillingErrorCode =
  | "insufficient_balance" // موجودیِ ≤ ۰ → باید شارژ شود
  | "model_not_found" // modelId در کاتالوگ نبود/غیرفعال است
  | "wallet_not_found" // کیف‌پولِ کاربر یافت نشد (نباید رخ دهد؛ getOrCreate)
  | "ai_maintenance" // حالتِ نگه‌داریِ هوش مصنوعی (سقفِ ماهانه یا پرچمِ دستی) → ۵۰۳
  | "apply_quota_exceeded"; // سقفِ اپلای روزانه‌ی پلنِ free پر شده → باید ارتقا دهد

/** خطای پایه‌ی بیلینگ با کدِ typed و علتِ اختیاری. */
export class BillingError extends Error {
  readonly code: BillingErrorCode;
  readonly cause?: unknown;

  constructor(code: BillingErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * موجودی برای یک فراخوانیِ پولی کافی نیست (پلنِ free یا موجودیِ ≤ ۰). این خطا
 * *پیش از* فراخوانیِ گیت‌وی پرتاب می‌شود تا هرگز به‌اشتباه هزینه‌ی بالادست خرج نشود.
 */
export class InsufficientBalanceError extends BillingError {
  /** موجودیِ فعلیِ کاربر به تومان (برای نمایش/تصمیمِ UI). */
  readonly balanceToman: number;
  /** پلنِ کاربر — برای پیامِ درست (هر پلنی با موجودیِ ≤ ۰ بلاک می‌شود). */
  readonly plan: Plan;

  constructor(args: {
    balanceToman: number;
    plan: Plan;
    message?: string;
  }) {
    super(
      "insufficient_balance",
      args.message ??
        "موجودیِ کیف‌پولِ شما برای استفاده از سرویسِ هوش مصنوعی کافی نیست. لطفاً کیف‌پول را شارژ کنید.",
    );
    this.name = "InsufficientBalanceError";
    this.balanceToman = args.balanceToman;
    this.plan = args.plan;
  }
}

/** مدلِ خواسته‌شده در کاتالوگ پیدا/فعال نیست — قیمتِ آن قابلِ محاسبه نیست. */
export class ModelNotFoundError extends BillingError {
  readonly modelId: string;
  constructor(modelId: string) {
    super(
      "model_not_found",
      `مدلِ «${modelId}» در کاتالوگِ قیمت‌گذاری یافت نشد یا غیرفعال است.`,
    );
    this.name = "ModelNotFoundError";
    this.modelId = modelId;
  }
}

/**
 * حالتِ نگه‌داریِ هوش مصنوعی فعال است (WF3 — گاردریلِ بودجه‌ی سراسری): یا جمعِ هزینه‌ی
 * بالادستِ این ماه به سقفِ ماهانه رسیده، یا پرچمِ دستیِ نگه‌داری روشن است.
 *
 * این خطا *پیش از* فراخوانیِ گیت‌وی پرتاب می‌شود (داخلِ meter، کنارِ assertCanUsePaidAi).
 * فراخواننده (route) باید ۵۰۳ + پیامِ فارسیِ روشن برگرداند. قابلیت‌های غیر-AI دست‌نخورده‌اند.
 */
export class AiMaintenanceError extends BillingError {
  /** آیا به‌خاطرِ پرچمِ دستی است (در برابرِ رسیدن به سقفِ بودجه)؟ */
  readonly manual: boolean;

  constructor(args: { manual?: boolean; message?: string } = {}) {
    super(
      "ai_maintenance",
      args.message ??
        "سرویس هوش مصنوعی موقتاً در دسترس نیست (سقف ماهانه).",
    );
    this.name = "AiMaintenanceError";
    this.manual = args.manual ?? false;
  }
}

/**
 * سقفِ اپلای روزانه‌ی پلنِ free پر شده (WF3 بخش D): کاربرِ رایگان حداکثر ۱۰۰ اپلای در
 * روز دارد. این خطا در نقطه‌ی ثبتِ یک اپلای (مسیرِ نتیجه‌ی صف) پرتاب می‌شود؛ پلن‌های
 * پولی سقف ندارند و هرگز این خطا را نمی‌گیرند.
 */
export class ApplyQuotaError extends BillingError {
  /** تعدادِ اپلای‌های امروز (در لحظه‌ی رد شدن). */
  readonly usedToday: number;
  /** سقفِ روزانه‌ی پلن. */
  readonly limit: number;

  constructor(args: { usedToday: number; limit: number; message?: string }) {
    super(
      "apply_quota_exceeded",
      args.message ??
        `به سقفِ ${args.limit} اپلای در روز رسیده‌اید. برای اپلای نامحدود، پلنِ خود را ارتقا دهید.`,
    );
    this.name = "ApplyQuotaError";
    this.usedToday = args.usedToday;
    this.limit = args.limit;
  }
}
