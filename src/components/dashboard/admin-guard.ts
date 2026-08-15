import "server-only";

/**
 * نگهبانِ بخشِ «مدیریت» داشبورد (server-only) — منبعِ حقیقتِ ادمین‌بودن.
 *
 * هویتِ ادمین از **ایمیلِ راستی‌آزمایی‌شده‌ی نشست** می‌آید، نه از یک کوکیِ دستی:
 *   • کاربر مثلِ همه با Google وارد می‌شود؛ نشست با pepper راستی‌آزمایی می‌شود.
 *   • اگر ایمیلِ آن نشست در allowlistِ `KARJOO_ADMIN_EMAILS` (یا مالکِ محصول) باشد،
 *     بخشِ مدیریت باز است. مقایسه در `isAdminEmail` انجام می‌شود.
 *
 * مرزِ امنیت (بحرانی):
 *   • هیچ رازی به کلاینت نشت نمی‌کند؛ فقط یک boolean به UI می‌رسد.
 *   • هرگز throw نمی‌کند: نبودِ نشست/DB/pepper ⇒ `false` (fail-closed).
 *   • *هر* صفحه و *هر* اکشنِ ادمین باید از `requireAdmin()` عبور کند — نه فقط UI را
 *     پنهان کند. پنهان‌کردنِ لینک امنیت نیست.
 *
 * سازگاریِ عقب‌رو: کوکیِ عملیاتیِ `karjoo_admin` (برابر با INTERNAL_API_SECRET) هم
 * پذیرفته می‌شود تا گردشِ کارِ اپراتورِ ناوگان (که ممکن است اصلاً حسابِ Google نداشته
 * باشد) نشکند. اگر رازِ سرور تنظیم نشده باشد، این مسیر بسته است.
 */
import { cookies } from "next/headers";

import { isAdminEmail, requireInternalSecret } from "@/lib/env";

import { getDashboardUser, type DashboardUser } from "./session";

/** نامِ کوکیِ عملیاتیِ ادمین (مقدارش باید برابرِ INTERNAL_API_SECRET باشد). */
export const ADMIN_COOKIE = "karjoo_admin";

/** کاربرِ ادمین — همان کاربرِ داشبورد؛ نوعِ جدا فقط برای خواناییِ امضاها. */
export type AdminUser = DashboardUser;

/**
 * ادمینِ جاری را برمی‌گرداند (یا null اگر ادمین نیست).
 *
 * ترتیب: اول نشست (مسیرِ اصلی)، بعد کوکیِ عملیاتی (مسیرِ اپراتور، بدونِ هویتِ کاربری).
 */
export async function getAdminUser(): Promise<AdminUser | null> {
  const user = await getDashboardUser();
  if (user && isAdminEmail(user.email)) return user;
  if (await hasOperatorCookie()) {
    // اپراتورِ ناوگان: نشستِ کاربری ندارد؛ هویتِ نمایشیِ حداقلی می‌سازیم.
    return (
      user ?? {
        userId: "operator",
        email: null,
        name: "اپراتور",
        avatarUrl: null,
        fullName: null,
      }
    );
  }
  return null;
}

/** آیا درخواستِ جاری مجوزِ ادمین دارد؟ هرگز throw نمی‌کند (fail-closed → false). */
export async function isDashboardAdmin(): Promise<boolean> {
  return (await getAdminUser()) !== null;
}

/**
 * نگهبانِ اکشن‌های ادمین: ادمین را برمی‌گرداند یا throw می‌کند.
 *
 * اکشن‌های سرور باید *قبل از هر کارِ جانبی* این را صدا بزنند. پیام عمداً بی‌جزئیات
 * است تا وجود/نبودِ راز یا فهرستِ ادمین‌ها را لو ندهد.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("دسترسی مجاز نیست.");
  return admin;
}

/**
 * برچسبِ ادمینِ عمل‌کننده برای ردِ ممیزی (`reviewedBy` و لاگ‌ها).
 * ایمیل بهترین شناسه است؛ اگر نبود (مسیرِ اپراتور) به `operator` می‌افتد.
 */
export function adminLabel(admin: AdminUser): string {
  return admin.email ?? admin.name ?? "operator";
}

/* ────────────────────────────  مسیرِ کوکیِ اپراتور  ───────────────────────── */

async function hasOperatorCookie(): Promise<boolean> {
  let expected: string;
  try {
    expected = requireInternalSecret();
  } catch {
    return false; // رازِ سرور تنظیم نشده → این مسیر بسته است.
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
