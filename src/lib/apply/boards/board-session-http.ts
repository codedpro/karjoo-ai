import "server-only";

/**
 * یک نشستِ HTTPِ کوکی‌دار برای اپلایِ سمتِ سرور.
 *
 * ورکرِ ناوگان نشستِ کاربر را در یک مرورگرِ واقعی replay می‌کند و مرورگر خودش کوکی‌ها را
 * بینِ درخواست‌ها نگه می‌دارد. سایت‌هایی که اپلای‌شان کاملاً HTTP است (کاربوم، ای‌استخدام،
 * ایران‌تلنت) به مرورگر نیاز ندارند — اما `fetch`ِ نود کوکی نگه نمی‌دارد و خودِ همان
 * تراکنش‌ها کوکی به‌روز می‌کنند (نشست، XSRF). این کلاس همان یک‌تکه‌ی گم‌شده است:
 * بسته‌ی نشستِ خزانه → هدرِ Cookie، و هر `set-cookie`ِ پاسخ دوباره جذبِ همان jar.
 *
 * §۱۰ — replayِ وفادار، نه جعل: کوکی‌ها و UA همان چیزی‌اند که خودِ کاربر داشته. اگر
 * بسته UA نداشته باشد یک UAِ معمولیِ کروم می‌نشیند (شناسه‌ی صادقانه‌ی یک کلاینت، نه
 * دور زدنِ تشخیص). نشست هرگز لاگ نمی‌شود و از این ماژول بیرون نمی‌رود.
 */
import { sessionBundleSchema } from "@/lib/api/session-schemas";
import { CookieJar } from "@/lib/apply/login/cookie-jar";

/** UAِ پیش‌فرض وقتی بسته‌ی نشست UAِ خودِ کاربر را ندارد. */
const FALLBACK_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 30_000;

/** پاسخِ یک درخواست — بدنه در صورتِ امکان JSON، وگرنه متنِ خام. */
export interface BoardHttpResponse {
  status: number;
  /** JSONِ parse‌شده، یا متنِ خام وقتی JSON نبود. */
  body: unknown;
  /** همیشه متنِ خام (برای تشخیص‌های متنی مثلِ کپچا). */
  raw: string;
  /** نشانیِ نهایی پس از redirectها. */
  url: string;
}

export interface BoardHttpOptions {
  /** `fetch`ِ قابلِ تزریق — تست‌ها شبکه را این‌جا قطع می‌کنند. */
  fetchImpl?: typeof fetch;
}

export class BoardHttpSession {
  private readonly jar: CookieJar;

  private constructor(
    private readonly origin: string,
    private readonly ua: string,
    jar: CookieJar,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.jar = jar;
  }

  /**
   * نشست را از بسته‌ی رمزگشایی‌شده‌ی خزانه باز می‌کند.
   * بسته‌ی بی‌کوکی → `null` (برای این سایت‌ها نشستِ بی‌کوکی اصلاً قابلِ استفاده نیست).
   */
  static open(
    origin: string,
    bundleJson: string,
    options: BoardHttpOptions = {},
  ): BoardHttpSession | null {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bundleJson);
    } catch {
      return null;
    }
    const parsed = sessionBundleSchema.safeParse(parsedJson);
    if (!parsed.success) return null;
    const cookies = parsed.data.cookies ?? [];
    if (cookies.length === 0) return null;

    const host = (() => {
      try {
        return new URL(origin).hostname;
      } catch {
        return "";
      }
    })();
    const jar = new CookieJar(host ? `.${host.replace(/^www\./, "")}` : "");
    for (const cookie of cookies) jar.set(cookie.name, cookie.value);

    return new BoardHttpSession(
      origin.replace(/\/+$/, ""),
      parsed.data.userAgent?.trim() || FALLBACK_USER_AGENT,
      jar,
      options.fetchImpl ?? fetch,
    );
  }

  get userAgent(): string {
    return this.ua;
  }

  /** آیا کوکی‌ای با این نام هنوز در نشست هست؟ */
  hasCookie(name: string): boolean {
    return this.jar.has(name);
  }

  /** مقدارِ یک کوکی (برای هدرهای XSRFی که سایت از کوکی می‌خواند). */
  cookie(name: string): string | undefined {
    return this.jar.all().find((c) => c.name === name)?.value;
  }

  /**
   * یک درخواستِ احرازشده. `path` یا نسبی است یا نشانیِ کاملِ همین مبدأ؛ هر مقصدِ
   * خارج از مبدأ رد می‌شود تا نشستِ کاربر به سایتِ دیگری نرود.
   */
  async request(path: string, init: RequestInit = {}): Promise<BoardHttpResponse> {
    const target = new URL(path, `${this.origin}/`);
    if (target.origin !== new URL(this.origin).origin) {
      throw new Error(`board-session: refusing cross-origin request to ${target.origin}`);
    }

    const headers = new Headers(init.headers);
    if (!headers.has("accept")) headers.set("accept", "application/json, text/html;q=0.9");
    if (!headers.has("accept-language")) headers.set("accept-language", "fa-IR,fa;q=0.9,en;q=0.8");
    headers.set("user-agent", this.ua);
    // مرورگر روی GETِ هم‌مبدأ هدرِ Origin نمی‌فرستد؛ فقط روی درخواست‌های تغییردهنده.
    // فرستادنش روی همه‌چیز یعنی درخواست‌های ما شکلی داشته باشند که هیچ مرورگری ندارد.
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") headers.set("origin", this.origin);
    if (!headers.has("referer")) headers.set("referer", `${this.origin}/`);
    const cookieHeader = this.jar.header();
    if (cookieHeader) headers.set("cookie", cookieHeader);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(target.toString(), {
        redirect: "follow",
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // هر کوکیِ تازه‌ای که سایت ست کرده، برای درخواستِ بعدیِ همین تراکنش لازم است.
    this.jar.absorb(response);

    const raw = await response.text();
    let body: unknown = raw;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        /* سایت گاهی HTML برمی‌گرداند؛ متنِ خام برای تشخیص کافی است. */
      }
    }
    return { status: response.status, body, raw, url: response.url || target.toString() };
  }
}

/** آیا این وضعیت یعنی نشست دیگر معتبر نیست؟ */
export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

/** آیا نشانیِ نهایی به صفحه‌ی ورود رسیده است؟ (ریدایرکتِ خاموشِ سایت‌های PHP) */
export function redirectedToLogin(url: string): boolean {
  try {
    return /\/(?:login|signin|sign-in|account\/login)(?:\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
