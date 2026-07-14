/**
 * پاک‌سازیِ متنِ مقصدِ ستونِ `text` پستگرس.
 *
 * پستگرس دو دسته ورودی را در ستونِ text *قطعی* رد می‌کند و خطای درج می‌دهد:
 *   • بایتِ NUL (U+0000) و سایرِ کاراکترهای کنترلیِ C0 (خطای 22021)،
 *   • UTF-8ِ نامعتبر ناشی از نیم-سوروگیت‌های تنها (U+D800..U+DFFFِ بی‌جفت).
 * خروجیِ مدل‌های زبانی گاهی این‌ها را دارد. اگر پاک نشوند، درجِ تطبیقِ *امتیازخورده* (که
 * هزینه‌اش پیشاپیش به 1xai پرداخت شده) می‌شکند و بسته به مسیر یا آگهی جا می‌افتد یا حلقه‌ی
 * «شارژ→درجِ ناموفق→تلاشِ دوباره→شارژِ دوباره» می‌سازد. این تابع تنها نقطه‌ی پاک‌سازی است تا
 * همه‌ی مصرف‌کننده‌ها (متِرینگ، runFilterApply، runJobinjaIngest) یکسان پوشش داده شوند.
 *
 * فقط کنترلی‌های C0 (جز tab/newline/CR) حذف می‌شوند و نیم-سوروگیت‌ها اصلاح؛ متنِ عادیِ
 * فارسی/انگلیسی/اموجی و جفت‌سوروگیتِ معتبر دست‌نخورده می‌ماند.
 */

/** بازه‌های کنترلیِ C0 که پستگرس رد می‌کند (tab=0x09، newline=0x0A، CR=0x0D نگه داشته می‌شوند). */
const CONTROL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
];

function isControl(codePoint: number): boolean {
  for (const [lo, hi] of CONTROL_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** متن را برای ستونِ text پستگرس امن می‌کند؛ null → null. */
export function sanitizePgText(s: string | null): string | null {
  if (s == null) return null;
  // نیم-سوروگیت‌های تنها را با U+FFFD جایگزین کن (Node ۲۲: String.prototype.toWellFormed).
  const withToWellFormed = s as { toWellFormed?: () => string };
  const wellFormed =
    typeof withToWellFormed.toWellFormed === "function" ? withToWellFormed.toWellFormed() : s;

  let out = "";
  // پیمایشِ کدپوینتی (نه واحدِ UTF-16) تا جفت‌سوروگیتِ معتبر نشکند.
  for (const ch of wellFormed) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isControl(cp)) continue;
    out += ch;
  }
  return out;
}
