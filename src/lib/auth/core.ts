import "server-only";

/**
 * هسته‌ی احراز هویت کارجو (server-only) — رمزنگاری + نشست، بدون هیچ HTTP.
 *
 * این لایه «خالص و قابل‌تزریق» است: همه‌ی وابستگی‌ها (دیتابیس، ساعت، تولید بایتِ
 * تصادفی) از طریق پارامتر تزریق می‌شوند تا تست بدون شبکه/DB واقعی و با زمان/تصادفِ
 * کنترل‌شده ممکن باشد. مسیرهای route (در لایه‌ی بالاتر) این توابع را صدا می‌زنند.
 *
 * قواعد ایمنی (بخش CONTEXT):
 *   • OTP و توکنِ نشست هرگز به‌صورت خام ذخیره نمی‌شوند؛ فقط hashِ آن‌ها (با pepperِ سرور).
 *   • مقایسه‌ها طول‌ثابت (timing-safe) است تا کانال جانبیِ زمان‌سنجی نشت ندهد.
 *   • توکنِ نشست یک رشته‌ی تصادفیِ ۲۵۶ بیتیِ مات است (نه JWT) — قابلِ ابطالِ سمتِ سرور.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { authSessions } from "@/db/schema";
import type { AuthSession } from "@/db/schema";
import { requireAuthPepper } from "@/lib/env";

/* ──────────────────────────────  وابستگی‌ها  ────────────────────────────── */

/**
 * هندلِ کمینه‌ای از Drizzle که این لایه به آن نیاز دارد. کلاینتِ واقعی این را
 * ارضا می‌کند؛ در تست یک fake سبک تزریق می‌شود (بدون DB زنده).
 */
export type AuthDb = Pick<typeof defaultDb, "insert" | "select" | "update">;

/** ساعتِ قابل‌تزریق — پیش‌فرض `Date.now`. تست‌ها زمان را قطعی می‌کنند. */
export type Clock = () => number;

/** تولیدکننده‌ی بایتِ تصادفی — پیش‌فرض `node:crypto`. قابل‌override در تست. */
export type RandomBytes = (size: number) => Buffer;

/** وابستگی‌های مشترکِ توابعِ نشست. */
export interface AuthDeps {
  db?: AuthDb;
  now?: Clock;
  /** override رازِ pepper (پیش‌فرض از env). فقط برای تست. */
  pepper?: string;
}

const defaultNow: Clock = () => Date.now();

/* ─────────────────────────────  ثابت‌ها  ────────────────────────────────── */

/** طولِ کدِ OTP (۶ رقم — مرسوم در سرویس‌های ایرانی). */
export const OTP_LENGTH = 6;

/** مدتِ اعتبارِ پیش‌فرضِ OTP (۵ دقیقه). */
export const OTP_TTL_MS = 5 * 60_000;

/** مدتِ اعتبارِ پیش‌فرضِ نشستِ وب (۳۰ روز). */
export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** مدتِ اعتبارِ پیش‌فرضِ نشستِ افزونه (۹۰ روز — کمتر تعامل با کاربر). */
export const EXTENSION_SESSION_TTL_MS = 90 * 24 * 60 * 60_000;

/** تعدادِ بایتِ توکنِ نشستِ خام (۲۵۶ بیت entropy). */
const SESSION_TOKEN_BYTES = 32;

/* ───────────────────────────────  هش  ──────────────────────────────────── */

/**
 * هشِ HMAC-SHA256 با pepperِ سرور. برای OTP و توکنِ نشست یکسان استفاده می‌شود.
 * خروجی hex. چون ورودی‌ها (توکنِ تصادفیِ پرانتروپی یا کدِ کوتاهِ هم‌بسته با phone)
 * قابلِ brute نیستند یا کوتاه‌عمرند، HMAC با pepper کافی است (نه نیازِ scrypt).
 */
export function hashWithPepper(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

/** مقایسه‌ی طول‌ثابتِ دو رشته‌ی hex (مقاوم در برابر زمان‌سنجی). */
export function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/* ───────────────────────────────  OTP  ─────────────────────────────────── */

/**
 * یک کدِ OTP عددیِ تصادفیِ امن می‌سازد (پیش‌فرض ۶ رقم). از `randomInt` استفاده می‌کند
 * (نه `Math.random`) تا قابلِ پیش‌بینی نباشد. رقم‌های ابتداییِ صفر حفظ می‌شوند.
 */
export function generateOtp(length: number = OTP_LENGTH): string {
  const max = 10 ** length;
  return String(randomInt(0, max)).padStart(length, "0");
}

/** هشِ یک کدِ OTP با pepperِ سرور (پیش‌فرض از env). */
export function hashOtp(code: string, pepper: string = requireAuthPepper()): string {
  return hashWithPepper(code, pepper);
}

/**
 * راستی‌آزماییِ یک کدِ OTP در برابرِ هشِ ذخیره‌شده. طول‌ثابت — هرگز کدِ خام را
 * مقایسه‌ی مستقیم نمی‌کند. به دیتابیس وابسته نیست (وضعیتِ مصرف/انقضا بالادست بررسی می‌شود).
 */
export function verifyOtp(
  code: string,
  storedHash: string,
  pepper: string = requireAuthPepper(),
): boolean {
  return safeEqualHex(hashOtp(code, pepper), storedHash);
}

/* ─────────────────────────────  نشست  ──────────────────────────────────── */

/** نتیجه‌ی صدورِ نشست: توکنِ خام (فقط همین‌جا و یک‌بار) + ردیفِ ذخیره‌شده. */
export interface IssuedSession {
  /** توکنِ خامِ مات — به کلاینت داده می‌شود؛ هرگز در DB نیست. */
  token: string;
  /** ردیفِ نشستِ ذخیره‌شده (شاملِ tokenHash، نه خود توکن). */
  sessionRow: AuthSession;
}

/** آپشن‌های صدورِ نشست. */
export interface IssueSessionOptions extends AuthDeps {
  /** override TTL بر حسب میلی‌ثانیه (پیش‌فرض بر اساس kind). */
  ttlMs?: number;
  userAgent?: string | null;
  /** override تولیدِ بایتِ تصادفی (تست). */
  randomBytesImpl?: RandomBytes;
}

/**
 * یک نشستِ تازه برای کاربر صادر می‌کند: توکنِ تصادفیِ ۲۵۶ بیتی می‌سازد، فقط هشش را
 * ذخیره می‌کند و توکنِ خام را برمی‌گرداند. توکنِ خام پس از این تابع دیگر بازیابی‌پذیر
 * نیست (در DB نیست) — این تنها فرصتِ دادنش به کلاینت است.
 */
export async function issueSession(
  userId: string,
  kind: "web" | "extension",
  opts: IssueSessionOptions = {},
): Promise<IssuedSession> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();
  const rand = opts.randomBytesImpl ?? randomBytes;

  const ttlMs =
    opts.ttlMs ?? (kind === "extension" ? EXTENSION_SESSION_TTL_MS : WEB_SESSION_TTL_MS);

  // توکنِ مات و url-safe (base64url) — نه JWT، تا قابلِ ابطالِ سمتِ سرور باشد.
  const token = rand(SESSION_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashWithPepper(token, pepper);
  const expiresAt = new Date(now() + ttlMs);

  const [sessionRow] = await db
    .insert(authSessions)
    .values({
      userId,
      tokenHash,
      kind,
      userAgent: opts.userAgent ?? null,
      expiresAt,
    })
    .returning();

  return { token, sessionRow };
}

/** کاربرِ احرازشده + ردیفِ نشست (خروجیِ راستی‌آزمایی). */
export interface VerifiedSession {
  userId: string;
  session: AuthSession;
}

/**
 * یک توکنِ نشستِ خام را راستی‌آزمایی می‌کند → نشستِ معتبر یا null. نشست باید:
 * موجود (با هشِ توکن)، باطل‌نشده (revokedAt = null) و منقضی‌نشده (expiresAt > now) باشد.
 * در صورت اعتبار، lastUsedAt را به‌روزرسانی می‌کند (best-effort).
 *
 * هشدارِ ایمنی: «نبودِ نشست» را با null برمی‌گردانیم تا فراخواننده fail-closed کند.
 */
export async function verifySessionToken(
  token: string,
  opts: AuthDeps = {},
): Promise<VerifiedSession | null> {
  if (!token) return null;
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();

  const tokenHash = hashWithPepper(token, pepper);

  const [row] = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() <= now()) return null;

  // به‌روزرسانیِ lastUsedAt — اگر شکست خورد، اعتبارِ نشست را باطل نمی‌کنیم.
  try {
    await db
      .update(authSessions)
      .set({ lastUsedAt: new Date(now()) })
      .where(eq(authSessions.id, row.id));
  } catch {
    // best-effort؛ نادیده می‌گیریم.
  }

  return { userId: row.userId, session: row };
}

/**
 * یک نشست را باطل می‌کند (خروج/امنیت). idempotent — اگر نشست از پیش باطل/ناموجود
 * باشد، بی‌سروصدا false برمی‌گرداند. با شناسه‌ی نشست کار می‌کند (نه توکنِ خام).
 */
export async function revokeSession(
  sessionId: string,
  opts: AuthDeps = {},
): Promise<boolean> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;

  const updated = await db
    .update(authSessions)
    .set({ revokedAt: new Date(now()) })
    .where(and(eq(authSessions.id, sessionId), isNull(authSessions.revokedAt)))
    .returning();

  return updated.length > 0;
}
