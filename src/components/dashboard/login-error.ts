/**
 * نگاشتِ خالصِ کدِ خطای ورود (query `?error`) به پیامِ دوستانه‌ی فارسی.
 *
 * مسیرهای OAuth (شروع/کال‌بک) هنگامِ شکست کاربر را با `?error=<code>` به /login
 * برمی‌گردانند. این تابع کد را به یک بنرِ قابلِ نمایش تبدیل می‌کند بدونِ افشای جزئیاتِ
 * فنی/راز. تابع محض است (بدونِ I/O) تا مستقل تست شود.
 *
 * کدهای شناخته‌شده:
 *   • state              → عدمِ تطبیقِ state (احتمالِ CSRF/انقضای جریان).
 *   • oauth              → خطای عمومیِ Google/تبادلِ توکن/دریافتِ پروفایل.
 *   • oauth_unconfigured → کلیدهای Google روی سرور تنظیم نشده‌اند.
 *   • access_denied      → کاربر در صفحه‌ی Google اجازه نداد.
 * هر کدِ ناشناخته → پیامِ عمومی.
 */

/** پیامِ عمومیِ شکستِ ورود (برای کدهای ناشناخته یا نبودِ کد → همان). */
export const GENERIC_LOGIN_ERROR = "ورود ناموفق بود، دوباره تلاش کنید.";

/** نگاشتِ کدهای شناخته‌شده به پیامِ فارسی. */
const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  state: GENERIC_LOGIN_ERROR,
  oauth: GENERIC_LOGIN_ERROR,
  oauth_unconfigured: GENERIC_LOGIN_ERROR,
  access_denied: "دسترسی به حسابِ گوگل لغو شد. برای ورود، اجازه‌ی دسترسی لازم است.",
};

/**
 * کدِ خطا را به پیامِ فارسی نگاشت می‌کند.
 *
 * ورودی می‌تواند `string`، آرایه (Next گاهی مقدارِ تکراری را آرایه می‌دهد)، یا
 * `undefined` باشد. اگر خطایی نباشد (undefined/تهی) → `null` برمی‌گردد تا بنر رندر نشود.
 * هر کدِ ناشناخته → پیامِ عمومی (هرگز کدِ خام را به کاربر نشان نمی‌دهیم).
 */
export function loginErrorMessage(
  error: string | string[] | undefined,
): string | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES[code] ?? GENERIC_LOGIN_ERROR;
}
