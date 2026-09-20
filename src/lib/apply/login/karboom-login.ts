import "server-only";

/**
 * ورودِ خودکارِ کاربوم از سمتِ سرور.
 *
 * کاربوم ورود را **دو مرحله‌ای** انجام می‌دهد (تأییدشده روی سایتِ زنده ۲۰۲۶-۰۹-۲۰):
 *
 *   ۱) GET  /account                → کوکیِ نشست + `_token`ِ CSRF
 *   ۲) POST /account {_token,email} → ۳۰۲ به /account/password?_t=<توکنِ امضاشده>
 *   ۳) GET  آن نشانی                → فرمِ مرحله‌ی دوم + `_token`ِ تازه
 *   ۴) POST /account/password {_token,password} → نشستِ واردشده
 *
 * ────────────────────────────────────────────────────────────────────────────
 * **نکته‌ی حیاتیِ ایمنی — هرگز حساب نساز.**
 * مرحله‌ی دوم برای ایمیلی که در کاربوم **ثبت نشده** همان صفحه را با دو فیلد
 * `password` + `password_confirmation` نشان می‌دهد؛ یعنی فرمِ *ثبت‌نام*، نه ورود.
 * اگر کورکورانه POST کنیم، به‌جای ورود یک حسابِ تازه برای کاربر می‌سازیم. پس وجودِ
 * `password_confirmation` را صریحاً تشخیص می‌دهیم و با `invalid_credentials`
 * برمی‌گردیم. (روی سایتِ زنده با یک ایمیلِ رزروشده‌ی RFC 2606 راستی‌آزمایی شد.)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * §۱۰: این اعتبارنامه‌ی خودِ کاربر است و کاربر صریحاً خواسته کارجو به‌جای او وارد شود.
 * هیچ کپچایی دور زده نمی‌شود؛ اگر سایت تأییدِ امنیتی بخواهد fail-closed می‌کنیم. رمز
 * فقط داخلِ همین تابع زندگی می‌کند: نه لاگ می‌شود، نه در نشستِ خروجی می‌نشیند.
 */
import { CookieJar } from "@/lib/apply/login/cookie-jar";
import type { BoardLoginDriver, LoginResult } from "@/lib/apply/login/types";

const ORIGIN = "https://karboom.io";
const ACCOUNT_URL = `${ORIGIN}/account`;
/** صفحه‌ی خصوصیِ کاربر — مهمان به /account ری‌دایرکت می‌شود. */
const VERIFY_PATH = "/profile";
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

/** PURE: `_token`ِ CSRF را از HTML بیرون می‌کشد (input یا meta). */
export function csrfTokenFrom(html: string): string | null {
  return (
    /<input[^>]+name=["']_token["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    null
  );
}

/**
 * PURE: آیا این صفحه‌ی مرحله‌ی دوم، فرمِ **ثبت‌نام** است؟
 *
 * کاربوم برای ایمیلِ ناشناس همان مسیر را می‌دهد ولی با `password_confirmation`.
 * تشخیصِ این تنها چیزی است که بینِ «ورود» و «ساختنِ حسابِ ناخواسته» ایستاده.
 */
export function looksLikeRegistration(html: string): boolean {
  return /name=["']password_confirmation["']/i.test(html);
}

/** PURE: آیا سایت تأییدِ امنیتی/کپچا می‌خواهد؟ */
export function looksLikeChallenge(html: string): boolean {
  return /recaptcha|hcaptcha|arcaptcha|g-recaptcha|mosparo|کد امنیتی|تصویر امنیتی/i.test(html);
}

/** PURE: پیامِ خطای کاربوم را به دلیلِ استاندارد نگاشت می‌کند. */
export function classifyAccountPage(html: string): LoginResult | null {
  if (looksLikeChallenge(html)) return { ok: false, reason: "security_challenge" };
  if (/رمز (ورود )?(اشتباه|نادرست|صحیح نیست)|اطلاعات ورود|invalid credentials/i.test(html)) {
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

/** PURE: نامِ نمایشیِ حساب از صفحه‌ی پروفایل (فقط برچسبِ غیرِمحرمانه). */
export function accountLabelFrom(html: string): string | null {
  const value =
    /<input[^>]+name=["'](?:full_?name|name)["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']profile:username["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    null;
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

export const karboomLoginDriver: BoardLoginDriver = {
  board: "karboom",

  async login(credential, fetchImpl: typeof fetch = fetch): Promise<LoginResult> {
    const jar = new CookieJar(".karboom.io");
    try {
      /* ۱ — صفحه‌ی ایمیل: کوکیِ نشست + `_token` ------------------------------- */
      const page = await fetchImpl(ACCOUNT_URL, {
        headers: { ...baseHeaders(jar), accept: "text/html" },
        redirect: "follow",
      });
      if (!page.ok) return { ok: false, reason: "unavailable", detail: `account page ${page.status}` };
      jar.absorb(page);
      const emailHtml = await page.text();
      if (looksLikeChallenge(emailHtml)) return { ok: false, reason: "security_challenge" };
      const emailToken = csrfTokenFrom(emailHtml);
      if (!emailToken) return { ok: false, reason: "provider_changed", detail: "csrf token not found" };

      /* ۲ — ارسالِ ایمیل → ۳۰۲ به مرحله‌ی رمز ---------------------------------- */
      const emailStep = await fetchImpl(ACCOUNT_URL, {
        method: "POST",
        headers: {
          ...baseHeaders(jar),
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          referer: ACCOUNT_URL,
        },
        body: new URLSearchParams({ _token: emailToken, email: credential.username }),
        redirect: "manual",
      });
      jar.absorb(emailStep);
      if (emailStep.status === 429) return { ok: false, reason: "rate_limited" };
      if (emailStep.status >= 500) {
        return { ok: false, reason: "unavailable", detail: `email step ${emailStep.status}` };
      }
      if (emailStep.status === 200) {
        // بدونِ ری‌دایرکت یعنی فرم را با خطا دوباره رندر کرده.
        return classifyAccountPage(await emailStep.text()) ?? { ok: false, reason: "invalid_credentials" };
      }
      const location = emailStep.headers.get("location");
      if (!location) return { ok: false, reason: "provider_changed", detail: "no password-step redirect" };
      const passwordUrl = new URL(location, ORIGIN);
      if (passwordUrl.origin !== ORIGIN) {
        // مقصدِ خارج از کاربوم یعنی ورودِ فدرال (گوگل/لینکدین) — اعتبارنامه‌ی ما آن‌جا کار نمی‌کند.
        return { ok: false, reason: "account_action_required", detail: "federated login required" };
      }

      /* ۳ — صفحه‌ی رمز: `_token`ِ تازه + تشخیصِ «این ایمیل ثبت نشده» ------------ */
      const passwordPage = await fetchImpl(passwordUrl.toString(), {
        headers: { ...baseHeaders(jar), accept: "text/html", referer: ACCOUNT_URL },
        redirect: "follow",
      });
      if (!passwordPage.ok) {
        return { ok: false, reason: "unavailable", detail: `password page ${passwordPage.status}` };
      }
      jar.absorb(passwordPage);
      const passwordHtml = await passwordPage.text();
      if (looksLikeChallenge(passwordHtml)) return { ok: false, reason: "security_challenge" };
      if (looksLikeRegistration(passwordHtml)) {
        // این ایمیل در کاربوم حساب ندارد. ارسالِ فرم یعنی ساختنِ حسابِ تازه — که
        // کاربر نخواسته. متوقف می‌شویم.
        return {
          ok: false,
          reason: "invalid_credentials",
          detail: "email is not registered on karboom (signup form shown)",
        };
      }
      const passwordToken = csrfTokenFrom(passwordHtml) ?? emailToken;

      /* ۴ — ارسالِ رمز ---------------------------------------------------------- */
      const submit = await fetchImpl(passwordUrl.toString(), {
        method: "POST",
        headers: {
          ...baseHeaders(jar),
          accept: "text/html",
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          referer: passwordUrl.toString(),
        },
        // فقط `password` — هرگز `password_confirmation` (آن مسیرِ ثبت‌نام است).
        body: new URLSearchParams({ _token: passwordToken, password: credential.password }),
        redirect: "manual",
      });
      jar.absorb(submit);
      if (submit.status === 429) return { ok: false, reason: "rate_limited" };
      if (submit.status >= 500) {
        return { ok: false, reason: "unavailable", detail: `password step ${submit.status}` };
      }
      if (submit.status === 200) {
        return classifyAccountPage(await submit.text()) ?? { ok: false, reason: "invalid_credentials" };
      }

      /* ۵ — اعتبارسنجیِ واقعی: صفحه‌ی خصوصی باید بدونِ برگشت به /account باز شود --- */
      const verify = await fetchImpl(`${ORIGIN}${VERIFY_PATH}`, {
        headers: { ...baseHeaders(jar), accept: "text/html" },
        redirect: "follow",
      });
      jar.absorb(verify);
      if (!verify.ok) return { ok: false, reason: "unavailable", detail: `verify ${verify.status}` };
      if (/^\/account(\/|$)/.test(new URL(verify.url).pathname)) {
        return { ok: false, reason: "invalid_credentials" };
      }
      const verifyHtml = await verify.text();
      if (looksLikeChallenge(verifyHtml)) return { ok: false, reason: "security_challenge" };

      const cookies = jar.all();
      if (cookies.length === 0) return { ok: false, reason: "session_unavailable" };
      const label = accountLabelFrom(verifyHtml);
      return {
        ok: true,
        sessionShape: "cookie",
        session: JSON.stringify({ cookies, userAgent: USER_AGENT }),
        expiresAt: jar.latestExpiry(),
        ...(label ? { accountLabel: label } : {}),
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
