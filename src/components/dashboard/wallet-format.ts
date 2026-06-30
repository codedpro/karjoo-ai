/**
 * کمک‌کننده‌های قالب‌بندیِ مبلغِ تومان برای UIِ بیلینگ — Track B.
 *
 * هیچ I/O؛ صرفاً رشته‌سازی. ارقامِ فارسی از `toFaDigits` (ui.tsx) جدا اعمال می‌شوند تا
 * این توابع خالص و قابلِ تستِ ساده بمانند.
 */

/**
 * مبلغِ تومان را با جداکننده‌ی هزارگان (لاتین) قالب می‌کند: 1234567 → "1,234,567".
 * علامتِ منفی حفظ می‌شود. ارقام بعداً با toFaDigits فارسی می‌شوند.
 */
export function formatToman(amount: number): string {
  const n = Math.trunc(amount);
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(n).toLocaleString("en-US");
  return `${sign}${digits}`;
}

/** مبلغِ علامت‌دار را با پیشوندِ +/− قالب می‌کند (برای ردیف‌های دفتر). */
export function formatSignedToman(amount: number): string {
  const n = Math.trunc(amount);
  if (n > 0) return `+${formatToman(n)}`;
  return formatToman(n); // منفی خودش − دارد؛ صفر بدونِ علامت.
}
