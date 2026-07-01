import "server-only";

/**
 * هسته‌ی «ورود با Google» — جریانِ سبکِ OAuth2 Authorization-Code (بدونِ NextAuth).
 *
 * سه گامِ استاندارد را پیاده می‌کند و هر کدام «قابلِ تزریق» (fetch injectable) است تا
 * واحدِ آن بدونِ شبکه/کلاینتِ زنده تست شود:
 *   ۱) buildGoogleAuthUrl — URLِ رضایتِ Google که کاربر به آن هدایت می‌شود.
 *   ۲) exchangeCodeForTokens — تبادلِ کدِ بازگشتی با توکن (server→Google).
 *   ۳) fetchGoogleUser — خواندنِ پروفایلِ کاربر با access token (userinfo).
 *
 * قواعد ایمنی:
 *   • این ماژول server-only است؛ CLIENT_SECRET هرگز به کلاینت نشت نمی‌کند.
 *   • هرگز توکن (access/id) یا کد یا secret را لاگ نمی‌کنیم.
 *   • state هنگامِ شروع به URL افزوده می‌شود؛ راستی‌آزماییِ state (CSRF/anti-replay)
 *     مسئولیتِ لایه‌ی route است (این‌جا فقط منتقلش می‌کنیم).
 *   • هر شکست یک GoogleOAuthErrorِ نوع‌دار می‌دهد (نه throwِ مبهم) تا route بتواند
 *     پاسخِ مناسب بسازد.
 */

/* ─────────────────────────────  ثابت‌ها  ────────────────────────────────── */

/** اندپوینتِ رضایتِ OAuth2 گوگل (جایی که کاربر را هدایت می‌کنیم). */
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** اندپوینتِ تبادلِ توکنِ گوگل (server→Google، POST). */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** اندپوینتِ userinfoِ OpenID Connect گوگل (خواندنِ پروفایل با access token). */
export const GOOGLE_USERINFO_ENDPOINT =
  "https://openidconnect.googleapis.com/v1/userinfo";

/** اسکوپ‌های موردِ نیاز — هویتِ پایه‌ی OpenID + ایمیل + پروفایل. */
export const GOOGLE_DEFAULT_SCOPE = "openid email profile";

/* ─────────────────────────────  خطاها  ─────────────────────────────────── */

/** علتِ نوع‌دارِ شکستِ جریانِ OAuth — برای شاخه‌بندیِ پاسخ در لایه‌ی route. */
export type GoogleOAuthErrorCode =
  | "token_exchange_failed" // تبادلِ کد با توکن ناموفق بود (پاسخِ غیرموفقِ Google).
  | "no_access_token" // پاسخِ توکن، access_token نداشت.
  | "userinfo_failed" // فراخوانیِ userinfo ناموفق بود.
  | "invalid_userinfo"; // userinfo فاقدِ sub/email بود (هویتِ ناقص).

/**
 * خطای نوع‌دارِ جریانِ OAuthِ گوگل. پیام عمداً بدونِ راز است (هرگز توکن/کد/secret).
 * `status` (در صورتِ وجود) کدِ HTTPِ پاسخِ بالادستیِ Google است (برای دیباگ/لاگِ امن).
 */
export class GoogleOAuthError extends Error {
  readonly code: GoogleOAuthErrorCode;
  readonly status?: number;

  constructor(code: GoogleOAuthErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GoogleOAuthError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/* ─────────────────────────────  وابستگی‌ها  ────────────────────────────── */

/** `fetch`ِ قابلِ تزریق — پیش‌فرض `globalThis.fetch`. تست یک fake سبک می‌دهد. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** وابستگی‌های مشترکِ توابعِ شبکه‌ایِ OAuth. */
export interface GoogleDeps {
  /** override برای `fetch` (تست/شبکه‌ی کنترل‌شده). */
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/* ─────────────────────────  ۱) URLِ رضایتِ Google  ──────────────────────── */

/** پارامترهای ساختِ URLِ رضایت. */
export interface BuildAuthUrlParams {
  clientId: string;
  /** اسکوپ‌ها — پیش‌فرض `openid email profile`. */
  scope?: string;
}

/**
 * URLِ رضایتِ Google را می‌سازد (گامِ ۱). کاربر به این آدرس هدایت می‌شود؛ پس از رضایت،
 * Google او را با `?code=...&state=...` به redirectUri برمی‌گرداند.
 *
 *   • response_type=code       — جریانِ Authorization Code.
 *   • access_type=online       — نیازی به refresh token نداریم (فقط ورود، نه دسترسیِ آفلاین).
 *   • prompt=select_account    — همیشه انتخابِ حساب را نشان بده (UXِ چند-حساب).
 *   • state                    — همان‌طور که داده شده منتقل می‌شود (راستی‌آزمایی در route).
 */
export function buildGoogleAuthUrl(
  state: string,
  redirectUri: string,
  params: BuildAuthUrlParams,
): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope ?? GOOGLE_DEFAULT_SCOPE);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

/* ───────────────────────  ۲) تبادلِ کد با توکن  ──────────────────────────── */

/** آپشن‌های تبادلِ کد — اعتبارنامه‌ی کلاینت + وابستگی‌ها. */
export interface ExchangeCodeOptions extends GoogleDeps {
  clientId: string;
  clientSecret: string;
}

/** توکن‌های بازگشتی از Google (فقط آنچه لازم داریم). */
export interface GoogleTokens {
  /** access token برای فراخوانیِ userinfo. */
  accessToken: string;
  /** id token (JWTِ OpenID) — در صورتِ وجود؛ ممکن است undefined باشد. */
  idToken?: string;
}

/**
 * کدِ Authorization را با توکن تبادل می‌کند (گامِ ۲، server→Google، POST form-urlencoded).
 *
 * `redirectUri` باید *دقیقاً* همان مقداری باشد که در buildGoogleAuthUrl استفاده شد؛ در غیر
 * این صورت Google با redirect_uri_mismatch رد می‌کند. اگر پاسخ غیرموفق باشد یا access_token
 * نداشته باشد، GoogleOAuthErrorِ نوع‌دار پرتاب می‌شود (هرگز بدنه‌ی رازدارِ خام را لاگ نمی‌کنیم).
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  opts: ExchangeCodeOptions,
): Promise<GoogleTokens> {
  const doFetch = opts.fetchImpl ?? defaultFetch;

  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  let res: Response;
  try {
    res = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch {
    // خطای شبکه/transport — بدونِ افشای جزئیاتِ راز.
    throw new GoogleOAuthError(
      "token_exchange_failed",
      "ارتباط با سرورِ توکنِ Google ناموفق بود.",
    );
  }

  if (!res.ok) {
    throw new GoogleOAuthError(
      "token_exchange_failed",
      "تبادلِ کدِ Google با توکن ناموفق بود.",
      res.status,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | { access_token?: unknown; id_token?: unknown }
    | null;

  const accessToken =
    data && typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) {
    throw new GoogleOAuthError(
      "no_access_token",
      "پاسخِ توکنِ Google فاقدِ access_token بود.",
      res.status,
    );
  }

  const idToken =
    data && typeof data.id_token === "string" ? data.id_token : undefined;

  return idToken !== undefined ? { accessToken, idToken } : { accessToken };
}

/* ───────────────────────  ۳) خواندنِ پروفایلِ کاربر  ─────────────────────── */

/** پروفایلِ نرمال‌شده‌ی کاربرِ Google (فقط فیلدهای موردِ نیازِ هویت). */
export interface GoogleUser {
  /** شناسه‌ی پایدارِ Google (claim `sub`) — هرگز تغییر نمی‌کند. */
  sub: string;
  /** ایمیلِ کاربر. */
  email: string;
  /** آیا Google ایمیل را تأیید کرده است. */
  emailVerified: boolean;
  /** نامِ نمایشی (در صورتِ وجود). */
  name?: string;
  /** آدرسِ آواتار (در صورتِ وجود). */
  picture?: string;
}

/**
 * پروفایلِ کاربر را از userinfoِ OpenID Connect می‌خواند (گامِ ۳، با access token).
 *
 * server→Google روی TLS. حداقلِ هویت (sub + email) را اعتبارسنجی می‌کند؛ اگر یکی نبود،
 * GoogleOAuthError('invalid_userinfo') می‌دهد تا هیچ‌وقت کاربرِ بی‌هویت ساخته نشود.
 * توکن هرگز لاگ نمی‌شود.
 */
export async function fetchGoogleUser(
  accessToken: string,
  opts: GoogleDeps = {},
): Promise<GoogleUser> {
  const doFetch = opts.fetchImpl ?? defaultFetch;

  let res: Response;
  try {
    res = await doFetch(GOOGLE_USERINFO_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new GoogleOAuthError(
      "userinfo_failed",
      "ارتباط با userinfoِ Google ناموفق بود.",
    );
  }

  if (!res.ok) {
    throw new GoogleOAuthError(
      "userinfo_failed",
      "خواندنِ پروفایلِ کاربرِ Google ناموفق بود.",
      res.status,
    );
  }

  const data = (await res.json().catch(() => null)) as
    | {
        sub?: unknown;
        email?: unknown;
        email_verified?: unknown;
        name?: unknown;
        picture?: unknown;
      }
    | null;

  const sub = data && typeof data.sub === "string" ? data.sub : "";
  const email = data && typeof data.email === "string" ? data.email : "";
  if (!sub || !email) {
    throw new GoogleOAuthError(
      "invalid_userinfo",
      "پروفایلِ Google فاقدِ sub یا email بود (هویتِ ناقص).",
    );
  }

  // email_verified ممکن است boolean یا رشته‌ی "true"/"false" باشد.
  const emailVerified =
    data?.email_verified === true || data?.email_verified === "true";
  const name =
    data && typeof data.name === "string" && data.name ? data.name : undefined;
  const picture =
    data && typeof data.picture === "string" && data.picture
      ? data.picture
      : undefined;

  return {
    sub,
    email,
    emailVerified,
    ...(name !== undefined ? { name } : {}),
    ...(picture !== undefined ? { picture } : {}),
  };
}
