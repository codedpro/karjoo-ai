/**
 * خطاهای typed لایه‌ی بیلینگ — تا فراخواننده (route/orchestrator) بتواند دقیق تصمیم
 * بگیرد و پیامِ درست به کاربر بدهد (مثلاً «شارژ لازم است» در برابر «مدل ناشناخته»).
 *
 * این فایل عمداً «server-only» نیست: فقط تعریفِ کلاسِ خطاست (بدونِ راز یا I/O)، تا هم
 * در سرور و هم در تستِ واحد بدونِ اصطکاک قابلِ استفاده باشد.
 */

/** کدهای پایدارِ خطای بیلینگ — برای مدیریتِ دقیق در فراخواننده. */
export type BillingErrorCode =
  | "insufficient_balance" // پلنِ free یا موجودیِ ≤ ۰ → باید شارژ شود
  | "model_not_found" // modelId در کاتالوگ نبود/غیرفعال است
  | "wallet_not_found"; // کیف‌پولِ کاربر یافت نشد (نباید رخ دهد؛ getOrCreate)

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
  /** پلنِ کاربر — برای پیامِ درست (free هرگز اجازه‌ی فراخوانیِ پولی ندارد). */
  readonly plan: "free" | "payg" | "premium";

  constructor(args: {
    balanceToman: number;
    plan: "free" | "payg" | "premium";
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
