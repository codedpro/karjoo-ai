import "server-only";

/**
 * GET /api/auth/google  — «شروعِ جریانِ ورود با Google» (OAuth2 Authorization-Code).
 *
 * گام‌ها:
 *   ۱) محدودسازیِ نرخِ سبک per-IP (بازاستفاده از checkOtpRateLimit) تا از اسپمِ redirect
 *      جلوگیری شود.
 *   ۲) اگر ورود با Google پیکربندی نشده باشد → 302 به /login?error=oauth_unconfigured
 *      (fail-closed، بدونِ نشتِ جزئیات).
 *   ۳) یک `state`ِ تصادفیِ ۲۵۶ بیتی می‌سازد و آن را در یک کوکیِ کوتاه‌عمرِ httpOnly
 *      (karjoo_oauth_state) می‌نشاند تا در callback با پارامترِ state مقایسه شود (CSRF).
 *   ۴) 302 به URLِ رضایتِ Google (buildGoogleAuthUrl با همان redirectUriِ حل‌شده).
 *
 * قواعدِ ایمنی: state هرگز قابلِ حدس نیست؛ کوکی httpOnly + secure(prod) + sameSite=lax +
 * کوتاه‌عمر است. هیچ رازی (client_secret/توکن) این‌جا لمس نمی‌شود.
 */
import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { buildGoogleAuthUrl } from "@/lib/auth/google";
import { checkOtpRateLimit, clientIp } from "@/lib/auth/http";
import { isGoogleOAuthConfigured, requireGoogleOAuth } from "@/lib/env";

// به node API (crypto/cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی شروعِ جریانِ OAuth نباید بیفتد.
export const dynamic = "force-dynamic";

/** نامِ کوکیِ کوتاه‌عمرِ نگه‌دارنده‌ی state (anti-CSRF بینِ شروع و callback). */
export const OAUTH_STATE_COOKIE = "karjoo_oauth_state";

/** عمرِ کوکیِ state — ۱۰ دقیقه (پنجره‌ی رفت‌وبرگشتِ رضایتِ کاربر). */
export const OAUTH_STATE_MAX_AGE_S = 10 * 60;

/** مقصدِ نهاییِ خطا (صفحه‌ی ورود). */
function loginRedirect(error: string): Response {
  // Location نسبی — پشتِ reverse-proxy از request.url (که localhost:3030 است) استفاده نکن.
  return new Response(null, { status: 302, headers: { Location: `/login?error=${error}` } });
}

export async function GET(request: Request): Promise<Response> {
  // ۱) محدودسازیِ نرخِ سبک per-IP — جلوگیری از اسپمِ redirectِ OAuth.
  const ip = clientIp(request);
  if (!checkOtpRateLimit(`oauth-start-ip:${ip}`)) {
    return loginRedirect("rate_limited");
  }

  // ۲) پیکربندی‌نشده → پاسخِ سریعِ روشن (بدونِ throw/نشتِ جزئیات).
  if (!isGoogleOAuthConfigured()) {
    return loginRedirect("oauth_unconfigured");
  }

  // اعتبارنامه + redirectUriِ حل‌شده (همان مقدار در callback هم استفاده می‌شود).
  const { clientId, redirectUri } = requireGoogleOAuth();

  // ۳) stateِ تصادفیِ مات و url-safe؛ در کوکیِ کوتاه‌عمرِ httpOnly نگه داشته می‌شود.
  const state = randomBytes(32).toString("base64url");
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_S,
  });

  // ۴) هدایت به صفحه‌ی رضایتِ Google.
  const authUrl = buildGoogleAuthUrl(state, redirectUri, { clientId });
  return new Response(null, { status: 302, headers: { Location: authUrl } });
}
