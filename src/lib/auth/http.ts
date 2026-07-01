import "server-only";

/**
 * چسبِ نازکِ HTTP برای احراز هویت کارجو — بین route handlerها و هسته‌ی auth.
 *
 * این فایل «منطقِ خالصِ» احراز هویت (otp/verify/session/pairing) را از هسته
 * (`@/lib/auth/core`, `pairing`, `sms`) مصرف می‌کند و فقط مسئولیت‌های مخصوصِ HTTP را
 * می‌افزاید که هسته عمداً ندارد:
 *   • مدیریتِ کوکیِ نشست (httpOnly + secure + sameSite) با `next/headers`.
 *   • محدودسازیِ نرخِ درخواستِ OTP (in-memory، سطلِ کوچک) تا اسپمِ پیامک گرفته شود.
 *   • گردشِ کارِ «درخواست/راستی‌آزماییِ OTP» روی DB (پیدا/ساختِ کاربر، ذخیره‌ی هش،
 *     سقفِ تلاش، مصرفِ یک‌بارمصرف) — همه قابل‌تزریق برای تستِ بدونِ DB/شبکه.
 *
 * این لایه هسته را *ویرایش نمی‌کند*؛ فقط آن را صدا می‌زند. همه‌ی وابستگی‌ها (db, now,
 * pepper, random, sms) قابلِ تزریق‌اند تا route handlerها نازک و تست‌پذیر بمانند.
 */
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { otpCodes, users } from "@/db/schema";
import type { User } from "@/db/schema";
import { getSmsConfig, requireAuthPepper } from "@/lib/env";
import {
  OTP_LENGTH,
  OTP_TTL_MS,
  generateOtp,
  hashOtp,
  issueSession,
  revokeSession,
  verifyOtp,
  verifySessionToken,
  type AuthDb,
  type Clock,
  type IssuedSession,
  type RandomBytes,
} from "@/lib/auth/core";
import { sendOtpSms, type SendOtpOptions, type SendOtpResult } from "@/lib/auth/sms";

/* ─────────────────────────────  کوکیِ نشست  ─────────────────────────────── */

/** نامِ کوکیِ نشستِ وب. مات و بی‌نشانه (هیچ چیزی درباره‌ی محتوا فاش نمی‌کند). */
export const SESSION_COOKIE = "karjoo_session";

/**
 * یک کوکیِ نشستِ امن می‌نویسد. توکن مات است (نه JWT) و فقط هشش در DB است؛ پس کوکی
 * تنها حاملِ راز است → httpOnly (دور از JS کلاینت) + secure در پروداکشن + sameSite=lax
 * (تا ناوبریِ بالا-سطح کار کند ولی CSRF سخت شود).
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

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد (همان AuthDb + خواندنِ users/otp). */
export type AuthHttpDb = AuthDb;

/** وابستگی‌های قابل‌تزریقِ گردشِ کارِ احراز هویت (تست). */
export interface AuthHttpDeps {
  db?: AuthHttpDb;
  now?: Clock;
  pepper?: string;
  randomBytesImpl?: RandomBytes;
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

/** فقط فیلدهای غیرحساسِ کاربر برای بدنه‌ی پاسخ (هرگز چیزی فراتر از این لو نده). */
export function publicUser(user: User): {
  id: string;
  phone: string;
  fullName: string | null;
} {
  return { id: user.id, phone: user.phone, fullName: user.fullName ?? null };
}

/* ───────────────────────  محدودسازیِ نرخِ درخواستِ OTP  ──────────────────── */

/** پیکربندیِ محدودساز: حداکثر `max` درخواست در پنجره‌ی `windowMs`. */
export const OTP_RATE_LIMIT_MAX = 5;
export const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60_000; // ۱۰ دقیقه

/** سطلِ ساده‌ی درون‌حافظه‌ای per-key (در پروداکشنِ چندنمونه‌ای باید به Redis برود). */
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

/**
 * یک محدودساز نرخِ سبک. اگر کلید (مثلاً شماره) از سقف بگذرد false برمی‌گرداند.
 * قابلِ تزریقِ زمان برای تست؛ حالتش بین فراخوانی‌ها در همان فرایند می‌ماند.
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

/* ── محدودیتِ نرخِ سخت‌گیرانه‌تر بر اساسِ IP ─────────────────────────────────
 * دفاع در برابرِ یک IP که چند شماره/کد را می‌کوبد (مکملِ محدودیتِ per-phone). همه از
 * همان سطلِ درون‌حافظه‌ایِ checkOtpRateLimit استفاده می‌کنند؛ در پروداکشنِ چندنمونه‌ای
 * باید به Redis منتقل شود. */
/** سقفِ «درخواستِ کد» از یک IP در پنجره‌ی ۱۰ دقیقه. */
export const OTP_REQUEST_IP_MAX = 15;
/** سقفِ «راستی‌آزماییِ کد» از یک IP در پنجره‌ی ۱۰ دقیقه. */
export const OTP_VERIFY_IP_MAX = 20;
/** سقفِ «راستی‌آزماییِ کد» روی یک شماره در پنجره‌ی ۱۰ دقیقه (مکملِ سقفِ ۵-تلاشِ per-code). */
export const OTP_VERIFY_PHONE_MAX = 8;

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

/* ─────────────────────────────  درخواستِ OTP  ───────────────────────────── */

/** سقفِ تلاشِ راستی‌آزمایی روی یک کدِ OTP پیش از باطل‌شدنش. */
export const OTP_MAX_ATTEMPTS = 5;

/** آپشن‌های `requestOtp` — وابستگی‌ها + override برای ارسالِ پیامک. */
export interface RequestOtpOptions extends AuthHttpDeps {
  /** override ارسالِ پیامک (تست). پیش‌فرض: sendOtpSms واقعی. */
  sendOtp?: (phone: string, code: string, smsOpts?: SendOtpOptions) => Promise<SendOtpResult>;
  /** آپشن‌های پاس‌شده به لایه‌ی پیامک (مثلِ config/logger در تست). */
  smsOptions?: SendOtpOptions;
}

/**
 * یک OTPِ لاگین برای یک شماره می‌سازد، هشش را ذخیره می‌کند و از طریقِ پیامک می‌فرستد
 * (در نبودِ providerِ پیامک، لاگ می‌شود — حالتِ توسعه). کاربرِ تازه ساخته نمی‌شود اینجا؛
 * هویت هنگامِ verify (یا ساختِ کاربر) قطعی می‌شود تا شمارش/ساختِ زودهنگام رخ ندهد.
 *
 * هرگز فاش نمی‌کند که شماره وجود دارد یا نه — صدازننده‌ی route همیشه پاسخِ عمومی می‌دهد.
 */
export async function requestOtp(
  phone: string,
  opts: RequestOtpOptions = {},
): Promise<{ sms: SendOtpResult }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();
  const send = opts.sendOtp ?? sendOtpSms;

  // حالتِ توسعه: اگر هیچ providerِ پیامکی پیکربندی نشده باشد، از کدِ ثابتِ توسعه (همه ۱)
  // استفاده می‌کنیم تا بدونِ دیدنِ کنسولِ سرور هم بشود وارد شد. به‌محضِ پیکربندیِ SMS
  // (Kavenegar/generic) خودکار به کدِ تصادفیِ امن برمی‌گردد.
  const code =
    getSmsConfig() === null ? "1".repeat(OTP_LENGTH) : generateOtp(OTP_LENGTH);
  const codeHash = hashOtp(code, pepper);
  const expiresAt = new Date(now() + OTP_TTL_MS);

  await db
    .insert(otpCodes)
    .values({ phone, codeHash, purpose: "login", expiresAt })
    .returning();

  const sms = await send(phone, code, opts.smsOptions);
  return { sms };
}

/* ──────────────────────────────  راستی‌آزماییِ OTP  ─────────────────────── */

/** نتیجه‌ی typed راستی‌آزماییِ OTP — موفقیت با کاربر+نشست، یا یک علتِ شکست. */
export type VerifyOtpOutcome =
  | { ok: true; user: User; session: IssuedSession }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "mismatch" };

/** آپشن‌های `verifyOtpAndLogin`. */
export interface VerifyOtpOptions extends AuthHttpDeps {
  userAgent?: string | null;
}

/**
 * یک کدِ OTP را برای یک شماره راستی‌آزمایی می‌کند و در صورتِ موفقیت، کاربر را
 * (در صورتِ نبودن) می‌سازد و یک نشستِ 'web' صادر می‌کند. قواعد:
 *   • فقط جدیدترین کدِ مصرف‌نشده‌ی همان شماره بررسی می‌شود.
 *   • منقضی‌شده → شکست (`expired`).
 *   • سقفِ تلاش رد شده → شکست (`too_many_attempts`).
 *   • کدِ غلط → attempts++ و شکست (`mismatch`).
 *   • کدِ درست → مصرفِ کد (یک‌بارمصرف)، پیدا/ساختِ کاربر، صدورِ نشست.
 *
 * هیچ توکنِ خامی ذخیره نمی‌شود؛ مقایسه‌ها طول‌ثابت‌اند (در هسته).
 */
export async function verifyOtpAndLogin(
  phone: string,
  code: string,
  opts: VerifyOtpOptions = {},
): Promise<VerifyOtpOutcome> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();

  // کدهای مصرف‌نشده‌ی این شماره را بگیر و جدیدترین (بزرگ‌ترین createdAt) را انتخاب کن.
  // عمداً مرتب‌سازیِ سمتِ DB استفاده نمی‌کنیم تا منطق مستقل از ترتیبِ بازگشتِ ردیف‌ها
  // باشد؛ انتخابِ جدیدترین در کد قطعی است (هم با Postgres، هم با فیکسچرِ تست).
  const candidates = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)));

  const otp = candidates.reduce<(typeof candidates)[number] | undefined>(
    (newest, row) =>
      !newest || row.createdAt.getTime() > newest.createdAt.getTime() ? row : newest,
    undefined,
  );

  if (!otp) return { ok: false, reason: "no_code" };

  if (otp.expiresAt.getTime() <= now()) {
    return { ok: false, reason: "expired" };
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  if (!verifyOtp(code, otp.codeHash, pepper)) {
    // تلاشِ ناموفق را بشمار (سقفِ حدسِ متوالی).
    await db
      .update(otpCodes)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(otpCodes.id, otp.id));
    return { ok: false, reason: "mismatch" };
  }

  // کدِ درست → یک‌بارمصرف: همین‌حالا مصرفش کن (با شرطِ هنوز-مصرف‌نشده، race-safe).
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: new Date(now()) })
    .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
    .returning();

  // اگر کسِ دیگری همزمان مصرفش کرد، این درخواست بازنده است (دوباره استفاده نشود).
  if (!consumed || consumed.length === 0) {
    return { ok: false, reason: "mismatch" };
  }

  const user = await findOrCreateUserByPhone(phone, { db, now });
  const session = await issueSession(user.id, "web", {
    db,
    now,
    pepper,
    userAgent: opts.userAgent ?? null,
    ...(opts.randomBytesImpl ? { randomBytesImpl: opts.randomBytesImpl } : {}),
  });

  return { ok: true, user, session };
}

/**
 * کاربرِ یک شماره را برمی‌گرداند یا (در صورتِ نبودن) می‌سازد. شماره شناسه‌ی یکتای هویت
 * است (users_phone_uq). کاربرِ تازه فعال (isActive=true، پیش‌فرضِ schema) است.
 */
export async function findOrCreateUserByPhone(
  phone: string,
  opts: AuthHttpDeps = {},
): Promise<User> {
  const db = opts.db ?? defaultDb;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(users).values({ phone }).returning();
  return created;
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
