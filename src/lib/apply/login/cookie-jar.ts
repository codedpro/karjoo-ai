import "server-only";

/**
 * یک cookie jarِ کوچکِ درون‌حافظه‌ای برای ورودِ سمتِ سرور.
 *
 * `fetch`ِ نود کوکی‌ها را بینِ درخواست‌ها نگه نمی‌دارد، اما ورودِ فرم‌محور (جابینجا)
 * دقیقاً به همین نیاز دارد: کوکیِ نشستِ صفحه‌ی ورود باید همراهِ POST برود. این jar
 * فقط در حافظه و فقط برای یک تلاشِ ورود زندگی می‌کند و هرگز لاگ نمی‌شود.
 */

export interface JarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Unix ثانیه، برای کوکی‌های غیرِ session. */
  expirationDate?: number;
}

/** یک هدرِ Set-Cookie را به کوکی تبدیل می‌کند (نه‌بیشتر از آنچه لازم است). */
export function parseSetCookie(header: string, defaultDomain: string): JarCookie | null {
  const [pair, ...attrs] = header.split(";");
  const eq = pair?.indexOf("=") ?? -1;
  if (!pair || eq <= 0) return null;
  const cookie: JarCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: defaultDomain,
    path: "/",
  };
  for (const attr of attrs) {
    const idx = attr.indexOf("=");
    const key = (idx < 0 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const value = idx < 0 ? "" : attr.slice(idx + 1).trim();
    if (key === "domain" && value) cookie.domain = value.startsWith(".") ? value : `.${value}`;
    else if (key === "path" && value) cookie.path = value;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "expires" && value) {
      const at = Date.parse(value);
      if (Number.isFinite(at)) cookie.expirationDate = Math.floor(at / 1000);
    } else if (key === "max-age" && value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) cookie.expirationDate = Math.floor(Date.now() / 1000) + seconds;
    }
  }
  return cookie;
}

export class CookieJar {
  private readonly cookies = new Map<string, JarCookie>();

  constructor(private readonly defaultDomain: string) {}

  /** هر Set-Cookieِ این پاسخ را جذب می‌کند. کوکیِ خالی‌شده حذف می‌شود (logout). */
  absorb(response: Response): void {
    const headers = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
    for (const header of headers) {
      const cookie = parseSetCookie(header, this.defaultDomain);
      if (!cookie) continue;
      if (cookie.value === "") this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie);
    }
  }

  /** هدرِ Cookie برای درخواستِ بعدی. */
  header(): string {
    return [...this.cookies.values()].map((c) => `${c.name}=${c.value}`).join("; ");
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  /** آیا کوکیِ ماندگاری با این پیشوند وجود دارد؟ (مثلِ remember_<hash>ِ جابینجا) */
  hasPrefix(prefix: string): boolean {
    const lower = prefix.toLowerCase();
    return [...this.cookies.keys()].some((name) => name.toLowerCase().startsWith(lower));
  }

  all(): JarCookie[] {
    return [...this.cookies.values()];
  }

  /** دورترین انقضای بینِ کوکی‌ها — تخمینِ عمرِ نشست. */
  latestExpiry(): Date | null {
    const times = this.all()
      .map((c) => c.expirationDate)
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    return times.length > 0 ? new Date(Math.max(...times) * 1000) : null;
  }
}
