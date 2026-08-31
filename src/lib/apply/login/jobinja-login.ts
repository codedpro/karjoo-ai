import "server-only";

/**
 * ورودِ خودکارِ جابینجا از سمتِ سرور.
 *
 * جابینجا یک اپِ Laravel است: صفحه‌ی /login/user یک `_token`ِ CSRF می‌دهد که به کوکیِ
 * همان صفحه گره خورده، و فرم به همان نشانی POST می‌شود. با `remember_me` یک کوکیِ
 * ماندگارِ `remember_<hash>` صادر می‌شود که نشست را ماه‌ها زنده نگه می‌دارد — همان چیزی
 * که «اپلای در زمانِ خوابِ کاربر» به آن نیاز دارد.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10: این اعتبارنامه‌ی خودِ کاربر است و کاربر صریحاً خواسته کارجو به‌جای او وارد شود.
 * هیچ کپچایی دور زده نمی‌شود: اگر سایت تأییدِ امنیتی بخواهد، fail-closed می‌کنیم و
 * کاربر را خبر می‌کنیم. رمزِ عبور فقط در همین تابع زندگی می‌کند؛ نه لاگ می‌شود، نه در
 * نشستِ خروجی می‌نشیند.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { CookieJar } from "@/lib/apply/login/cookie-jar";
import type { BoardLoginDriver, LoginResult } from "@/lib/apply/login/types";

const ORIGIN = "https://jobinja.ir";
const LOGIN_URL = `${ORIGIN}/login/user`;
/** صفحه‌ی خصوصیِ کاربر — مهمان به /login/user ری‌دایرکت می‌شود. */
const VERIFY_PATH = "/app/cv-builder";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function baseHeaders(jar: CookieJar): Record<string, string> {
  const cookie = jar.header();
  return {
    "user-agent": USER_AGENT,
    "accept-language": "fa-IR,fa;q=0.9,en;q=0.8",
    ...(cookie ? { cookie } : {}),
  };
}

/** PURE: `_token`ِ CSRF را از HTMLِ صفحه‌ی ورود بیرون می‌کشد. */
export function csrfTokenFrom(html: string): string | null {
  return (
    /<input[^>]+name=["']_token["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    null
  );
}

/** PURE: آیا این صفحه تأییدِ امنیتی/کپچا می‌خواهد؟ */
export function looksLikeChallenge(html: string): boolean {
  return /recaptcha|hcaptcha|arcaptcha|g-recaptcha|کد امنیتی|تصویر امنیتی/i.test(html);
}

/** PURE: پیامِ خطای جابینجا را به دلیلِ استاندارد نگاشت می‌کند. */
export function classifyLoginPage(html: string): LoginResult | null {
  if (looksLikeChallenge(html)) return { ok: false, reason: "security_challenge" };
  if (/نام کاربری یا رمز عبور|اطلاعات ورود (شما )?(صحیح|درست) نیست|invalid credentials/i.test(html)) {
    return { ok: false, reason: "invalid_credentials" };
  }
  if (/تعداد تلاش|too many attempts|throttle/i.test(html)) {
    return { ok: false, reason: "rate_limited" };
  }
  if (/فعال\s*سازی|تأیید ایمیل|verify your email/i.test(html)) {
    return { ok: false, reason: "account_action_required" };
  }
  return null;
}

export const jobinjaLoginDriver: BoardLoginDriver = {
  board: "jobinja",

  async login(credential, fetchImpl: typeof fetch = fetch): Promise<LoginResult> {
    const jar = new CookieJar(".jobinja.ir");
    try {
      // ۱) صفحه‌ی ورود: کوکیِ نشست + `_token`.
      const page = await fetchImpl(LOGIN_URL, {
        headers: { ...baseHeaders(jar), accept: "text/html" },
        redirect: "follow",
      });
      if (!page.ok) return { ok: false, reason: "unavailable", detail: `login page ${page.status}` };
      jar.absorb(page);
      const html = await page.text();
      if (looksLikeChallenge(html)) return { ok: false, reason: "security_challenge" };
      const token = csrfTokenFrom(html);
      if (!token) return { ok: false, reason: "provider_changed", detail: "csrf token not found" };

      // ۲) ارسالِ فرم. redirect=manual تا Set-Cookieِ پاسخِ ۳۰۲ را از دست ندهیم.
      const body = new URLSearchParams({
        _token: token,
        identifier: credential.username,
        password: credential.password,
        remember_me: "1",
      });
      const submit = await fetchImpl(LOGIN_URL, {
        method: "POST",
        headers: {
          ...baseHeaders(jar),
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          referer: LOGIN_URL,
        },
        body,
        redirect: "manual",
      });
      jar.absorb(submit);
      if (submit.status === 429) return { ok: false, reason: "rate_limited" };
      if (submit.status >= 500) {
        return { ok: false, reason: "unavailable", detail: `login ${submit.status}` };
      }
      if (submit.status === 200) {
        // Laravel re-renders the form with errors instead of redirecting.
        const classified = classifyLoginPage(await submit.text());
        return classified ?? { ok: false, reason: "invalid_credentials" };
      }

      // ۳) اعتبارسنجیِ واقعی: صفحه‌ی خصوصی باید بدونِ ری‌دایرکت به ورود باز شود.
      const verify = await fetchImpl(`${ORIGIN}${VERIFY_PATH}`, {
        headers: { ...baseHeaders(jar), accept: "text/html" },
        redirect: "follow",
      });
      jar.absorb(verify);
      if (!verify.ok) return { ok: false, reason: "unavailable", detail: `verify ${verify.status}` };
      if (/\/login(\/|$)/.test(new URL(verify.url).pathname)) {
        return { ok: false, reason: "invalid_credentials" };
      }
      const verifyHtml = await verify.text();
      if (looksLikeChallenge(verifyHtml)) return { ok: false, reason: "security_challenge" };

      const cookies = jar.all();
      if (cookies.length === 0) return { ok: false, reason: "session_unavailable" };
      return {
        ok: true,
        sessionShape: "cookie",
        session: JSON.stringify({ cookies, userAgent: USER_AGENT }),
        expiresAt: jar.latestExpiry(),
        ...(accountLabelFrom(verifyHtml) ? { accountLabel: accountLabelFrom(verifyHtml)! } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: "unavailable",
        detail: error instanceof Error ? error.message : "network error",
      };
    }
  },
};

/** PURE: نامِ نمایشیِ غیرِ محرمانه از صفحه‌ی خصوصی، اگر پیدا شود. */
export function accountLabelFrom(html: string): string | undefined {
  const match =
    /<meta[^>]+name=["']user-name["'][^>]+content=["']([^"']{1,80})["']/i.exec(html)?.[1] ??
    /class=["'][^"']*c-userMenu__name[^"']*["'][^>]*>\s*([^<]{1,80})</i.exec(html)?.[1];
  return match?.trim() || undefined;
}
