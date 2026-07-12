import "server-only";

/**
 * GET /api/auth/callback/google  — «بازگشت از Google» (OAuth2 Authorization-Code).
 *
 * این آدرس باید *دقیقاً* همان redirect URIِ مجاز روی کلاینتِ Google باشد
 * (https://karjooai.itmaster.uk/api/auth/callback/google). Google پس از رضایتِ کاربر او را
 * با `?code=...&state=...` به این‌جا برمی‌گرداند.
 *
 * گام‌ها:
 *   ۱) پیکربندی‌نشده → 302 /login?error=oauth_unconfigured.
 *   ۲) code/state را از query بخوان؛ اگر یکی نبود → 302 /login?error=oauth.
 *   ۳) stateِ query را با کوکیِ karjoo_oauth_state مقایسه کن (CSRF/anti-replay). عدمِ تطابق
 *      (یا نبودِ کوکی) → 302 /login?error=state. کوکیِ state در هر حال پاک می‌شود (یک‌بارمصرف).
 *   ۴) exchangeCodeForTokens → fetchGoogleUser → findOrCreateUserByGoogle.
 *   ۵) issueSession('web') → setSessionCookie(token) → 302 /dashboard.
 *   ۶) هر GoogleOAuthError → 302 /login?error=oauth (بدونِ نشتِ جزئیات).
 *
 * قواعدِ ایمنی: هرگز code/state/توکن/secret لاگ نمی‌شود. مقایسه‌ی state طول‌ثابت است.
 */
import { cookies } from "next/headers";

import { issueSession, WEB_SESSION_TTL_MS } from "@/lib/auth/core";
import {
  GoogleOAuthError,
  exchangeCodeForTokens,
  fetchGoogleUser,
} from "@/lib/auth/google";
import { findOrCreateUserByGoogle, setSessionCookie } from "@/lib/auth/http";
import { isGoogleOAuthConfigured, requireGoogleOAuth } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import { EVENTS, flush, identify, track } from "@/lib/analytics";
import { OAUTH_STATE_COOKIE } from "@/app/api/auth/google/route";

// به DB و node API (crypto/cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی callbackِ OAuth نباید بیفتد.
export const dynamic = "force-dynamic";

/** ساختِ یک پاسخِ 302 به یک مسیرِ محلی (نسبت به مبدأِ درخواست). */
function redirect(path: string): Response {
  // Location نسبی است: مرورگر آن را نسبت به دامنه‌ای که کاربر واقعاً از آن آمده حل می‌کند.
  // پشتِ reverse-proxy، request.url آدرسِ داخلیِ localhost:3030 است و نباید مبنای redirect شود.
  return new Response(null, { status: 302, headers: { Location: path } });
}

/**
 * مقایسه‌ی طول‌ثابتِ دو رشته (مقاوم در برابر کانالِ زمان‌سنجی) — برای تطبیقِ state.
 * رشته‌ی خالی هرگز با چیزی برابر نمی‌شود مگر هر دو خالی باشند (که این‌جا رخ نمی‌دهد؛
 * پیش از فراخوانی، خالی‌بودنِ state جداگانه رد می‌شود).
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function GET(request: Request): Promise<Response> {
  // ۱) پیکربندی‌نشده → پاسخِ سریعِ روشن.
  if (!isGoogleOAuthConfigured()) {
    return redirect("/login?error=oauth_unconfigured");
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  const state = searchParams.get("state") ?? "";

  // کوکیِ state را بخوان و بلافاصله پاک کن (یک‌بارمصرف؛ حتی در مسیرهای خطا).
  const store = await cookies();
  const cookieState = store.get(OAUTH_STATE_COOKIE)?.value ?? "";
  store.delete(OAUTH_STATE_COOKIE);

  // ۳) راستی‌آزماییِ state (CSRF): باید موجود و برابرِ کوکی باشد.
  if (!state || !cookieState || !timingSafeEqualStr(state, cookieState)) {
    return redirect("/login?error=state");
  }

  // ۲) نبودِ code → خطای عمومیِ OAuth (مثلاً کاربر رضایت را رد کرده و Google
  //    با ?error=access_denied برگشته).
  if (!code) {
    return redirect("/login?error=oauth");
  }

  try {
    const { clientId, clientSecret, redirectUri } = requireGoogleOAuth();

    // ۴) تبادلِ کد با توکن → خواندنِ پروفایل → پیدا/ساختِ کاربر.
    const { accessToken } = await exchangeCodeForTokens(code, redirectUri, {
      clientId,
      clientSecret,
    });
    const profile = await fetchGoogleUser(accessToken);

    // ایمیلِ تأییدنشده را نمی‌پذیریم: جلوگیری از account-linking با ایمیلی که کاربر
    // مالکش نیست (fallbackِ پیدا/ساخت بر اساسِ ایمیل نباید با ایمیلِ تأییدنشده رخ دهد).
    if (profile.emailVerified === false) {
      return redirect("/login?error=email_unverified");
    }

    const user = await findOrCreateUserByGoogle({
      sub: profile.sub,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    });

    // کاربرِ غیرفعال/بن‌شده هرگز نشست نمی‌گیرد — هم‌رفتار با مسیرِ گذرواژه. گرچه
    // گیت‌های پایین‌دست (getUserFromToken) کوکیِ چنین کاربری را رد می‌کنند، صدورِ نشست
    // برای حسابِ غیرفعال ناسازگاریِ بینِ دو مسیرِ ورود بود.
    if (user.isActive === false) {
      return redirect("/login?error=oauth");
    }

    // ۵) صدورِ نشستِ وب + نشاندنِ کوکیِ نشست (userAgent برای رصد/ابطال).
    const userAgent = request.headers.get("user-agent");
    const { token } = await issueSession(user.id, "web", { userAgent });
    await setSessionCookie(token, WEB_SESSION_TTL_MS);

    // آنالیتیکسِ سرور: identify کاربر (نشست تازه برقرار شد) + رویدادِ ورود. best-effort و
    // مقید به نشست (userId از DB، نه ورودیِ کلاینت). هر خطا بلعیده می‌شود — ورود هرگز نمی‌شکند.
    try {
      identify(user.id, {
        email: user.email ?? undefined,
        name: user.name ?? undefined,
      });
      track(user.id, EVENTS.LOGIN, { method: "google" });
      // چون کانتینر بلندعمر است و کاربر بلافاصله redirect می‌شود، flush می‌کنیم تا
      // رویدادِ ورود پیش از پاسخ به PostHog برسد (flush هرگز throw نمی‌کند).
      await flush();
    } catch {
      /* آنالیتیکس هرگز مسیرِ ورود را نمی‌شکند. */
    }

    return redirect("/dashboard");
  } catch (err) {
    // خطای نوع‌دارِ OAuth (تبادلِ توکن/userinfo/هویتِ ناقص) → پاسخِ عمومی، بدونِ نشت.
    if (err instanceof GoogleOAuthError) {
      return redirect("/login?error=oauth");
    }
    // خطای غیرمنتظره: در لاگِ سرور ثبت شود (بدونِ code/توکن)، به کاربر پاسخِ عمومی.
    console.error("[auth/callback/google] unexpected error:", err);
    // لاگِ ساخت‌یافته به هابِ مشاهده‌پذیری (Loki) — بدونِ نشتِ code/state/توکن؛ فقط زمینه‌ی
    // امنِ اشکال‌زدایی. logger هرگز throw/بلاک نمی‌کند، پس رفتارِ مسیر تغییری نمی‌کند.
    logger.error("oauth callback unexpected error", {
      route: "auth/callback/google",
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return redirect("/login?error=oauth");
  }
}
