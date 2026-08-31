import "server-only";

/**
 * قراردادِ مشترکِ «ورودِ خودکارِ سمتِ سرور» برای سایت‌های کاریابی.
 *
 * هر درایور با اعتبارنامه‌ی خودِ کاربر وارد می‌شود و **نشست** برمی‌گرداند — همان شکلی
 * که خزانه‌ی نشست (session_blobs) ذخیره می‌کند و ورکر replay می‌کند. رمزِ عبور از این
 * مرز فراتر نمی‌رود: نه لاگ می‌شود، نه در نشست می‌نشیند، نه به ورکر می‌رسد.
 */

/** دلایلِ شکستِ ورود — کوتاه، بدونِ افشای اعتبارنامه. */
export type LoginFailureReason =
  /** نام کاربری/رمز پذیرفته نشد — تکرار بی‌فایده است. */
  | "invalid_credentials"
  /** سایت کپچا یا تأییدِ امنیتی خواست — سرور نمی‌تواند و نباید دور بزند. */
  | "security_challenge"
  /** سایت درخواست‌ها را محدود کرد؛ بعداً دوباره. */
  | "rate_limited"
  /** حساب نیاز به کاری دارد که فقط کاربر می‌تواند انجام دهد (تأیید ایمیل/شماره). */
  | "account_action_required"
  /** ورود ظاهراً موفق بود اما نشستِ قابل استفاده‌ای به دست نیامد. */
  | "session_unavailable"
  /** شبکه/سایت در دسترس نبود. */
  | "unavailable"
  /** شکلِ فرم/API عوض شده — به‌روزرسانیِ درایور لازم است. */
  | "provider_changed";

export interface LoginSuccess {
  ok: true;
  /** نشستِ سریال‌شده — دقیقاً همان قراردادی که ورکر parse می‌کند. */
  session: string;
  /** شکلِ نشست، برای ستونِ session_blobs. */
  sessionShape: "cookie" | "token";
  /** انقضای تخمینی، اگر سایت اعلام کند. */
  expiresAt: Date | null;
  /** برچسبِ غیرِ محرمانه‌ی حساب برای نمایش (نام یا ایمیل). */
  accountLabel?: string;
}

export interface LoginFailure {
  ok: false;
  reason: LoginFailureReason;
  /** پیامِ کوتاهِ خودِ سایت، در صورت وجود — هرگز شاملِ اعتبارنامه. */
  detail?: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

/** آیا این شکست با تکرارِ خودکار برطرف می‌شود؟ */
export function isRetryableLoginFailure(reason: LoginFailureReason): boolean {
  return reason === "rate_limited" || reason === "unavailable";
}

export interface BoardLoginDriver {
  readonly board: string;
  login(
    credential: { username: string; password: string },
    fetchImpl?: typeof fetch,
  ): Promise<LoginResult>;
}
