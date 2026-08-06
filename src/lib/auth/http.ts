import "server-only";

/**
 * چسبِ نازکِ HTTP برای احراز هویت کارجو — بین route handlerها و هسته‌ی auth.
 *
 * هویتِ کاربر با **ورود با Google** تعیین می‌شود (نه OTPِ پیامکی). این فایل منطقِ خالصِ
 * نشست (issue/verify از `@/lib/auth/core`) را مصرف می‌کند و مسئولیت‌های مخصوصِ HTTP را
 * می‌افزاید که هسته عمداً ندارد:
 *   • مدیریتِ کوکیِ نشست (httpOnly + secure + sameSite) با `next/headers`.
 *   • پیدا/ساختِ کاربر از پروفایلِ Google (findOrCreateUserByGoogle).
 *   • محدودسازیِ نرخِ درخواست (in-memory) — برای اندپوینتِ «شروعِ جریانِ OAuth».
 *
 * این لایه هسته را *ویرایش نمی‌کند*؛ فقط آن را صدا می‌زند. همه‌ی وابستگی‌ها (db, now,
 * pepper, random) قابلِ تزریق‌اند تا route handlerها نازک و تست‌پذیر بمانند.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users } from "@/db/schema";
import type { User } from "@/db/schema";
import { requireAuthPepper } from "@/lib/env";
import { extractBearerToken } from "@/lib/api/bearer-auth";
import { ensureOnexaiLink, type UnifiedDb } from "@/lib/billing/unified";
import {
  revokeSession,
  verifySessionToken,
  type AuthDb,
  type Clock,
  type RandomBytes,
} from "@/lib/auth/core";

/* ─────────────────────────────  کوکیِ نشست  ─────────────────────────────── */

/** نامِ کوکیِ نشستِ وب. مات و بی‌نشانه (هیچ چیزی درباره‌ی محتوا فاش نمی‌کند). */
export const SESSION_COOKIE = "karjoo_session";

/**
 * یک کوکیِ نشستِ امن می‌نویسد. توکن مات است (نه JWT) و فقط هشش در DB است؛ پس کوکی
 * تنها حاملِ راز است → httpOnly (دور از JS کلاینت) + secure در پروداکشن + sameSite=lax
 * (تا ناوبریِ بالا-سطح — مثلِ بازگشت از Google — کار کند ولی CSRF سخت شود).
 */
export async function setSessionCookie(token: string, maxAgeMs: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

/** کوکیِ نشست را پاک می‌کند (خروج). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** توکنِ نشست را از کوکیِ درخواست می‌خواند (یا null). */
export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/* ──────────────────────────  کاربرِ احرازشده  ───────────────────────────── */

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد (همان AuthDb + خواندنِ users). */
export type AuthHttpDb = AuthDb;

/** وابستگی‌های قابل‌تزریقِ گردشِ کارِ احراز هویت (تست). */
export interface AuthHttpDeps {
  db?: AuthHttpDb;
  now?: Clock;
  pepper?: string;
  randomBytesImpl?: RandomBytes;
  /**
   * گره‌زدنِ کاربر به استخرِ مشترکِ 1xai (اختیاری، تزریقی برای تست). اگر داده نشود،
   * از `ensureOnexaiLink` واقعی استفاده می‌شود (resolve با email → ذخیره‌ی
   * onexai_user_id). best-effort است — هرگز نباید ورود را بشکند، حتی اگر 1xai
   * موقتاً در دسترس نباشد (گیت‌های پولی بعداً خودشان دوباره تلاش می‌کنند).
   */
  linkOnexai?: (userId: string) => Promise<unknown>;
}

const defaultNow: Clock = () => Date.now();

/**
 * کاربرِ جاری را از یک توکنِ نشست برمی‌گرداند (یا null). نشست را با هسته راستی‌آزمایی
 * می‌کند و سپس ردیفِ کاربر را می‌خواند؛ کاربرِ غیرفعال (isActive=false) معتبر نیست.
 */
export async function getUserFromToken(
  token: string | null,
  opts: AuthHttpDeps = {},
): Promise<User | null> {
  if (!token) return null;
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();

  const verified = await verifySessionToken(token, { db, now, pepper });
  if (!verified) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);

  // فقط کاربرِ صریحاً غیرفعال رد می‌شود (isActive در DB همیشه boolean است؛ این شکل
  // در برابرِ نبودِ صریحِ مقدار هم پایدار است).
  if (!user || user.isActive === false) return null;
  return user;
}

/** کاربرِ جاری را از کوکیِ درخواست برمی‌گرداند (یا null). میان‌برِ مسیرهای route. */
export async function getCurrentUser(opts: AuthHttpDeps = {}): Promise<User | null> {
  const token = await readSessionToken();
  return getUserFromToken(token, opts);
}

/**
 * کاربرِ جاری را از **کوکیِ وب یا هدرِ `Authorization: Bearer`** برمی‌گرداند (یا null).
 *
 * چرا لازم است: افزونه (MV3) از مبدأِ `chrome-extension://` صدا می‌زند، پس هرگز کوکیِ
 * هم‌مبدأِ کارجو را نمی‌فرستد؛ فقط توکنِ نشستِ خودش را در هدرِ Bearer می‌گذارد. مسیرهایی
 * که «هم وب و هم افزونه» صدایشان می‌زنند باید هر دو را بپذیرند، وگرنه افزونه همیشه ۴۰۱
 * می‌گیرد (باگِ خاموشی که کلِ «اپلای خودکارِ مرورگر» و پُرشدنِ vault را از کار انداخته بود).
 *
 * ایمنی: هر دو مسیر از همان `getUserFromToken` می‌گذرند — یعنی همان راستی‌آزماییِ نشست
 * (هشِ pepper-دار، منقضی/باطل‌نشده) و همان ردِ کاربرِ غیرفعال. هیچ مسیرِ ضعیف‌تری اضافه
 * نمی‌شود؛ فقط محلِ خواندنِ همان توکن دو حالت دارد.
 */
export async function getCurrentUserOrBearer(
  request: Request,
  opts: AuthHttpDeps = {},
): Promise<User | null> {
  const cookieUser = await getCurrentUser(opts);
  if (cookieUser) return cookieUser;
  return getUserFromToken(extractBearerToken(request), opts);
}

/** فقط فیلدهای غیرحساسِ کاربر برای بدنه‌ی پاسخ (هرگز چیزی فراتر از این لو نده). */
export function publicUser(user: User): {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
} {
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

/* ──────────────────────  پیدا/ساختِ کاربر از Google  ─────────────────────── */

/** پروفایلِ نرمال‌شده‌ی Google که برای پیدا/ساختِ کاربر لازم است. */
export interface GoogleIdentity {
  /** claim `sub` — شناسه‌ی پایدارِ Google (هویتِ اصلی). */
  sub: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * کاربرِ متناظر با یک هویتِ Google را برمی‌گرداند یا (در صورتِ نبودن) می‌سازد.
 *
 * قواعد:
 *   • ابتدا با `googleSub` جست‌وجو می‌شود (هویتِ پایدار). اگر نبود، fallback با `email`
 *     تا کاربرانی که قبلاً با ایمیل شناخته شده‌اند دوباره ساخته نشوند؛ در این حالت
 *     `googleSub` روی همان ردیف تثبیت می‌شود.
 *   • در هر ورود، `name`/`avatarUrl` (و در fallback، `googleSub`) به‌روزرسانی می‌شوند تا
 *     پروفایل تازه بماند. مقادیرِ خالی/undefined با مقدارِ قبلی جایگزین نمی‌شوند مگر
 *     Google مقدارِ تازه بدهد.
 *   • کاربرِ تازه فعال (isActive=true، پیش‌فرضِ schema) و با پلنِ free ساخته می‌شود.
 *   • هیچ اعتباری اعطا نمی‌شود — پول در استخرِ مشترکِ 1xai زندگی می‌کند؛ کارجو هرگز
 *     خودش را credit نمی‌کند. فقط گرهِ best-effort به استخر برقرار می‌شود.
 *
 * همه‌ی وابستگی‌ها قابلِ تزریق‌اند (تستِ بدونِ DB/شبکه).
 */
export async function findOrCreateUserByGoogle(
  identity: GoogleIdentity,
  opts: AuthHttpDeps = {},
): Promise<User> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;

  const name = identity.name ?? null;
  const avatarUrl = identity.avatarUrl ?? null;

  let user: User;

  // ۱) با googleSub (هویتِ پایدار).
  const [bySub] = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, identity.sub))
    .limit(1);

  if (bySub) {
    const [updated] = await db
      .update(users)
      .set({ name, avatarUrl, email: identity.email, updatedAt: new Date(now()) })
      .where(eq(users.id, bySub.id))
      .returning();
    user = updated ?? bySub;
  } else {
    // ۲) fallback با email (کاربرِ موجودی که هنوز به این googleSub گره نخورده).
    const [byEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, identity.email))
      .limit(1);

    if (byEmail) {
      const [updated] = await db
        .update(users)
        .set({ googleSub: identity.sub, name, avatarUrl, updatedAt: new Date(now()) })
        .where(eq(users.id, byEmail.id))
        .returning();
      user = updated ?? byEmail;
    } else {
      // ۳) کاربرِ تازه.
      const [created] = await db
        .insert(users)
        .values({ googleSub: identity.sub, email: identity.email, name, avatarUrl })
        .returning();
      user = created;
    }
  }

  // گرهِ best-effort به استخرِ مشترکِ 1xai (هویت/کیف‌پولِ واحد): اگر هنوز گره نخورده،
  // همین‌جا برقرار می‌شود تا مسیرهای پولی بعدی سریع باشند. اگر 1xai موقتاً پایین بود،
  // ورود *نباید* بشکند — گیت‌های پولی خودشان دوباره ensureOnexaiLink را صدا می‌زنند.
  if (user.onexaiUserId == null) {
    const link =
      opts.linkOnexai ??
      ((userId: string) => ensureOnexaiLink(userId, { db: db as unknown as UnifiedDb }));
    try {
      await link(user.id);
    } catch (err) {
      console.error("[auth] گرهِ کاربر به استخرِ 1xai ناموفق بود (best-effort):", err);
    }
  }

  return user;
}

/* ───────────────────────  محدودسازیِ نرخِ درخواست  ───────────────────────── */

/**
 * سطلِ ساده‌ی درون‌حافظه‌ای per-key. در اصل برای OTP بود؛ اکنون اندپوینتِ «شروعِ جریانِ
 * OAuth» (برای مثال کلید = IPِ کلاینت) از آن استفاده می‌کند تا از اسپمِ redirect جلوگیری شود.
 * در پروداکشنِ چندنمونه‌ای باید به Redis منتقل شود.
 */
export const OTP_RATE_LIMIT_MAX = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60_000; // ۱۰ دقیقه

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

/**
 * یک محدودساز نرخِ سبک. اگر کلید از سقف بگذرد false برمی‌گرداند. قابلِ تزریقِ زمان برای
 * تست؛ حالتش بین فراخوانی‌ها در همان فرایند می‌ماند.
 */
export function checkOtpRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = OTP_RATE_LIMIT_MAX,
  windowMs: number = OTP_RATE_LIMIT_WINDOW_MS,
): boolean {
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

/** پاک‌سازیِ حالتِ محدودساز (فقط برای تست — جداسازیِ بین تست‌ها). */
export function resetOtpRateLimit(): void {
  rateBuckets.clear();
}

/**
 * IPِ کلاینت را از هدرهای proxy می‌خواند (پشتِ reverse-proxy: اولین مقدارِ
 * x-forwarded-for، سپس x-real-ip، وگرنه 'unknown'). برای کلیدِ محدودساز.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/* ─────────────────────────────  خروج (logout)  ──────────────────────────── */

/**
 * نشستِ مربوط به یک توکن را باطل می‌کند (اگر معتبر باشد). idempotent — اگر توکن
 * نامعتبر/منقضی باشد بی‌سروصدا رد می‌شود. کوکی جداگانه (در route) پاک می‌شود.
 */
export async function logoutByToken(
  token: string | null,
  opts: AuthHttpDeps = {},
): Promise<boolean> {
  if (!token) return false;
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();

  const verified = await verifySessionToken(token, { db, now, pepper });
  if (!verified) return false;
  return revokeSession(verified.session.id, { db, now });
}
