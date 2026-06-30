import "server-only";

/**
 * نگهبانِ بخشِ ادمینِ ناوگان (server-only) — Track C.
 *
 * بخشِ ادمین با همان رازِ مشترکِ داخلیِ سرور (INTERNAL_API_SECRET) محافظت می‌شود — همان رازی
 * که مسیرهای /api/internal از آن استفاده می‌کنند. مرزِ امنیت (بحرانی):
 *   • راز *هرگز* به کلاینت نشت نمی‌کند؛ فقط سمتِ سرور با کوکیِ ادمین مقایسه می‌شود
 *     (مقایسه‌ی طول‌ثابت تا کانالِ زمان‌سنجی نشت ندهد).
 *   • اگر رازِ سرور تنظیم نشده باشد، بخشِ ادمین «بسته» است (fail-closed: هرگز با رازِ خالی باز).
 *   • هیچ صفحه/اکشنِ ادمینی بدونِ عبور از این نگهبان اجرا نمی‌شود.
 *
 * کاربر کوکیِ `karjoo_admin` را (با مقدارِ همان راز) به‌صورتِ دستی/خارج از باند ست می‌کند؛
 * این لایه فقط آن را راستی‌آزمایی می‌کند و خودش رازی صادر نمی‌کند.
 */
import { cookies } from "next/headers";

import { requireInternalSecret } from "@/lib/env";

/** نامِ کوکیِ ادمین (مقدارش باید برابرِ INTERNAL_API_SECRET باشد). */
export const ADMIN_COOKIE = "karjoo_admin";

/**
 * آیا درخواستِ جاری مجوزِ ادمین دارد؟ هرگز throw نمی‌کند (fail-closed → false):
 *   • رازِ سرور تنظیم نشده → false (بخشِ ادمین بسته).
 *   • کوکیِ ادمین نبود/نابرابر → false.
 *
 * مقایسه طول‌ثابت است تا حمله‌ی زمان‌سنجی نتواند راز را حدس بزند.
 */
export async function isFleetAdmin(): Promise<boolean> {
  let expected: string;
  try {
    expected = requireInternalSecret();
  } catch {
    return false; // رازِ سرور تنظیم نشده → fail-closed.
  }

  let provided = "";
  try {
    const store = await cookies();
    provided = store.get(ADMIN_COOKIE)?.value ?? "";
  } catch {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

/** مقایسه‌ی طول‌ثابتِ دو رشته (مقاوم در برابر حمله‌ی زمان‌سنجی). */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
