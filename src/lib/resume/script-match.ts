import "server-only";

/**
 * انتخابِ داده‌ی هم‌زبان با رزومه.
 *
 * پروفایلِ واقعیِ کاربر اغلب هر دو نسخه را دارد: تحصیلاتِ فارسی **و** همان تحصیلات به
 * انگلیسی. این بخش‌ها مستقیم از پروفایل رندر می‌شوند و از مدل عبور نمی‌کنند، پس در یک
 * رزومه‌ی انگلیسی هر دو ردیف کنارِ هم می‌نشستند — یکی ناخوانا برای خواننده و یکی تکراری.
 *
 * پس پیش از رندر، ردیف‌هایی را نگه می‌داریم که خطشان با زبانِ رزومه می‌خواند. اگر هیچ
 * ردیفی هم‌خط نبود، همه را نگه می‌داریم — نداشتنِ ترجمه بهتر از خالی‌ماندنِ بخش است.
 */

const PERSIAN_LETTERS = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** ارقامِ عربی-هندی و شکلِ گسترده‌شان — داخلِ همان بازه‌اند ولی «خط» را تعیین نمی‌کنند. */
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/**
 * آیا این متن به خطِ فارسی/عربی نوشته شده؟
 *
 * ارقام اول حذف می‌شوند: «۱۴۰۲» در یک ردیفِ کاملاً انگلیسی هم می‌آید (سالِ شمسی کنارِ
 * نامِ لاتین) و نباید کلِ ردیف را فارسی به‌حساب بیاورد.
 */
export function isPersianScript(value: string | null | undefined): boolean {
  return PERSIAN_LETTERS.test((value ?? "").replace(EASTERN_DIGITS, ""));
}

/**
 * ردیف‌های هم‌زبان با رزومه را برمی‌گرداند؛ اگر هیچ‌کدام هم‌زبان نبود، همه را.
 * `textOf` متنِ تعیین‌کننده‌ی هر ردیف را می‌دهد (مثلاً نامِ دانشگاه + رشته).
 */
export function preferLanguage<T>(
  items: readonly T[],
  lang: "fa" | "en",
  textOf: (item: T) => string,
): T[] {
  if (items.length === 0) return [];
  const wantPersian = lang === "fa";
  const matching = items.filter((it) => isPersianScript(textOf(it)) === wantPersian);
  return matching.length > 0 ? matching : [...items];
}
