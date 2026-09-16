/**
 * مقصدِ امنِ پس از ورود: فقط مسیرِ نسبیِ داخلی (`/dashboard/...`).
 *
 * آدرسِ کامل، مسیرِ protocol-relative (`//evil`)، بک‌اسلش (که مرورگرها به `//` تبدیل
 * می‌کنند) و کاراکترهای کنترلی رد می‌شوند و مقصدِ پیش‌فرض برمی‌گردد.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]");

export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  const v = value.trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return fallback;
  if (CONTROL_CHARS.test(v)) return fallback;
  return v;
}
