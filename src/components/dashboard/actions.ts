"use server";

/**
 * اکشن‌های سرورِ داشبورد — فقط mutationهایی که از UI داشبورد فراخوانی می‌شوند.
 *
 * این‌ها روی لایه‌ی auth-HTTP سوار می‌شوند (مصرف‌کننده‌اند) و هیچ رازی برنمی‌گردانند.
 * فعلاً فقط «خروج» را داریم: نشستِ جاری را سمتِ سرور باطل می‌کند و کوکی را پاک می‌کند،
 * سپس به /login می‌فرستد. منطقِ آن همان مسیرِ POST /api/auth/logout است، صرفاً به‌شکلِ
 * server action تا با فرمِ ساده (بدونِ JS) و redirect کار کند.
 */
import { redirect } from "next/navigation";

import { clearSessionCookie, logoutByToken, readSessionToken } from "@/lib/auth/http";

/**
 * خروج: نشست را (در صورت معتبر بودن) سمتِ سرور باطل می‌کند و کوکی را پاک می‌کند.
 * idempotent — اگر کوکی/نشست نبود هم بی‌سروصدا به /login می‌رود.
 */
export async function signOut(): Promise<void> {
  try {
    const token = await readSessionToken();
    await logoutByToken(token);
  } catch {
    // pepper/DB در دسترس نیست — باز هم کوکی را پاک می‌کنیم و می‌رویم.
  }

  try {
    await clearSessionCookie();
  } catch {
    // اگر کوکی هم پاک نشد، باز به /login می‌رویم.
  }

  redirect("/login");
}
