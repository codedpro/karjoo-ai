import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy — میان‌افزارِ لبه‌ی کارجو (Next 16؛ جایگزینِ `middleware.ts`).
 *
 * دو مسئولیتِ *ارزان* دارد (بدونِ DB، بدونِ راز، بدونِ I/O):
 *
 *   ۱) دروازه‌بانیِ حضورِ نشست برای `/dashboard/**`. صرفاً *وجودِ* کوکیِ نشست
 *      (`karjoo_session`) را چک می‌کند؛ اگر نباشد → redirect به /login. این یک
 *      «چکِ خوش‌بینانه»ی سبک است (قاعده‌ی proxy: برای راستی‌آزماییِ کامل نیست).
 *      راستی‌آزماییِ واقعیِ نشست همچنان سمتِ سرور در `getDashboardUser` انجام می‌شود
 *      (داخلِ Suspense)، پس کوکیِ جعلی/منقضی هم به داده نمی‌رسد؛ اینجا فقط
 *      بازدیدکننده‌ی بی‌نشست را زودتر و بدونِ رندرِ داشبورد به /login می‌فرستیم.
 *
 *   ۲) بازنویسیِ فایلِ کلیدِ IndexNow (`/{۳۲-hex}.txt`) به مسیرِ SDK تا موتورهای
 *      جست‌وجو مالکیت را تأیید کنند (رفتارِ قبلیِ middleware، حفظ‌شده).
 *
 * چون فقط کوکی می‌خواند و redirect/rewrite می‌کند، روی لبه سریع می‌ماند و پوسته‌ی
 * استاتیکِ داشبورد بی‌درنگ سِرو می‌شود.
 */

/** نامِ کوکیِ نشستِ وب — با `SESSION_COOKIE` در `@/lib/auth/http` یکسان.
 *  اینجا به‌صورتِ لفظی تکرار می‌شود تا proxy هیچ ماژولِ `server-only` را import نکند
 *  (لبه نباید به لایه‌ی auth/DB وابسته شود). */
const SESSION_COOKIE = "karjoo_session";

/** الگوی نامِ فایلِ کلیدِ IndexNow: ۳۲ کاراکترِ hex + `.txt`. */
const INDEXNOW_KEY_RE = /^\/[a-f0-9]{32}\.txt$/;

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // ۱) دروازه‌ی داشبورد — حضورِ کوکی (نه اعتبارش) کافی است تا رندر شروع شود.
  if (pathname.startsWith("/dashboard")) {
    const hasSession = req.cookies.has(SESSION_COOKIE);
    if (!hasSession) {
      const loginUrl = new URL("/login", req.url);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // ۲) بازنویسیِ کلیدِ IndexNow → مسیرِ SDK.
  if (INDEXNOW_KEY_RE.test(pathname)) {
    return NextResponse.rewrite(new URL("/api/indexnow-key", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // داشبورد (برای دروازه‌بانی) + بقیه‌ی مسیرها به‌جز داراییِ استاتیک (برای IndexNow).
  matcher: ["/dashboard/:path*", "/((?!_next/|favicon.ico).*)"],
};
