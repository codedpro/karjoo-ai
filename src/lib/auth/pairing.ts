import "server-only";

/**
 * هندآفِ اتصالِ دستگاه (Device-link SSO) برای افزونه — «بدون OTP دوم».
 *
 * جریان (بخش CONTEXT، قاعده‌ی ۵):
 *   1) کاربر در وب از پیش با OTP وارد شده است.
 *   2) `createPairingCode(userId)` یک کدِ جفت‌سازیِ یک‌بارمصرفِ کوتاه‌عمر می‌سازد؛
 *      فقط هشش ذخیره می‌شود و کدِ خام به کاربر نشان داده/به افزونه منتقل می‌شود.
 *   3) افزونه `redeemPairingCode(code)` را صدا می‌زند → یک نشستِ 'extension' می‌گیرد.
 *      هیچ phone-OTP دومی لازم نیست؛ هویت از همان حسابِ وب می‌آید.
 *
 * مثلِ هسته، این لایه «خالص و قابل‌تزریق» است (db/now/random از پارامتر) و هیچ HTTP
 * ندارد. کدِ جفت‌سازی هرگز خام ذخیره نمی‌شود.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { deviceLinks } from "@/db/schema";
import type { DeviceLink } from "@/db/schema";
import { requireAuthPepper } from "@/lib/env";
import {
  EXTENSION_SESSION_TTL_MS,
  hashWithPepper,
  issueSession,
  revokeSession,
  type AuthDb,
  type Clock,
  type IssuedSession,
  type RandomBytes,
} from "@/lib/auth/core";

/** مدتِ اعتبارِ پیش‌فرضِ کدِ جفت‌سازی (۱۰ دقیقه — کوتاه‌عمر، یک‌بارمصرف). */
export const PAIRING_TTL_MS = 10 * 60_000;

/** تعدادِ بایتِ کدِ جفت‌سازیِ خام (۱۶۰ بیت entropy — مات و غیرقابل‌حدس). */
const PAIRING_CODE_BYTES = 20;

/** هندلِ DB که این لایه نیاز دارد — همان AuthDb (insert/select/update). */
export type PairingDb = AuthDb;

/** وابستگی‌های قابل‌تزریقِ توابعِ جفت‌سازی. */
export interface PairingDeps {
  db?: PairingDb;
  now?: Clock;
  pepper?: string;
  randomBytesImpl?: RandomBytes;
}

const defaultNow: Clock = () => Date.now();

/** خروجیِ ساختِ کدِ جفت‌سازی: کدِ خام (یک‌بار) + ردیفِ ذخیره‌شده. */
export interface PairingCode {
  /** کدِ خامِ مات (base64url) — فقط همین‌جا؛ هرگز در DB نیست. */
  code: string;
  /** ردیفِ device_link ذخیره‌شده (شاملِ هش، نه خود کد). */
  link: DeviceLink;
}

/**
 * یک کدِ جفت‌سازیِ یک‌بارمصرف برای کاربر می‌سازد و ردیفِ `pending` ذخیره می‌کند.
 * کاربر باید از پیش احرازشده باشد (مسئولیتِ لایه‌ی route است که این تابع را فقط برای
 * یک نشستِ وبِ معتبر صدا بزند).
 */
export async function createPairingCode(
  userId: string,
  opts: PairingDeps = {},
): Promise<PairingCode> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();
  const rand = opts.randomBytesImpl ?? randomBytes;

  const code = rand(PAIRING_CODE_BYTES).toString("base64url");
  const pairingCodeHash = hashWithPepper(code, pepper);
  const expiresAt = new Date(now() + PAIRING_TTL_MS);

  const [link] = await db
    .insert(deviceLinks)
    .values({ userId, pairingCodeHash, status: "pending", expiresAt })
    .returning();

  return { code, link };
}

/** خروجیِ redeem موفق: نشستِ افزونه + ردیفِ device_link به‌روزشده. */
export interface RedeemedPairing {
  session: IssuedSession;
  link: DeviceLink;
}

/**
 * یک کدِ جفت‌سازی را مصرف می‌کند و یک نشستِ 'extension' صادر می‌کند.
 * کد باید: موجود (با هش)، در وضعیتِ `pending` و منقضی‌نشده باشد. در صورت موفقیت،
 * ردیف به `linked` می‌رود و به نشستِ تازه اشاره می‌کند (یک‌بارمصرف — redeemِ دوم
 * چون دیگر `pending` نیست null برمی‌گرداند).
 *
 * در صورتِ نامعتبر/منقضی/مصرف‌شده، null برمی‌گرداند (فراخواننده fail-closed کند).
 */
export async function redeemPairingCode(
  code: string,
  opts: PairingDeps & { userAgent?: string | null } = {},
): Promise<RedeemedPairing | null> {
  if (!code) return null;
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? defaultNow;
  const pepper = opts.pepper ?? requireAuthPepper();

  const pairingCodeHash = hashWithPepper(code, pepper);

  const [link] = await db
    .select()
    .from(deviceLinks)
    .where(
      and(
        eq(deviceLinks.pairingCodeHash, pairingCodeHash),
        eq(deviceLinks.status, "pending"),
      ),
    )
    .limit(1);

  if (!link) return null;

  // منقضی؟ علامتش بزن و رد کن (تا redeemِ بعدی هم سریع برگردد).
  if (link.expiresAt.getTime() <= now()) {
    await db
      .update(deviceLinks)
      .set({ status: "expired" })
      .where(eq(deviceLinks.id, link.id));
    return null;
  }

  // نشستِ افزونه را صادر کن (همان pepper/now/db را برای قطعیتِ تست پاس می‌دهیم).
  const session = await issueSession(link.userId, "extension", {
    db,
    now,
    pepper,
    ttlMs: EXTENSION_SESSION_TTL_MS,
    userAgent: opts.userAgent ?? null,
    ...(opts.randomBytesImpl ? { randomBytesImpl: opts.randomBytesImpl } : {}),
  });

  // device_link را به `linked` ببر و به نشست اشاره بده — اتمیک با شرطِ هنوز-pending
  // تا دو redeemِ همزمان فقط یکی موفق شود (race-safe، یک‌بارمصرف).
  const [updated] = await db
    .update(deviceLinks)
    .set({ status: "linked", linkedSessionId: session.sessionRow.id })
    .where(and(eq(deviceLinks.id, link.id), eq(deviceLinks.status, "pending")))
    .returning();

  // اگر بین select و update کسِ دیگری آن را برد، updated خالی است → redeem باخت.
  // نشستِ تازه‌ساخته را باطل کن تا یتیم نماند (best-effort).
  if (!updated) {
    await revokeSession(session.sessionRow.id, { db, now });
    return null;
  }

  return { session, link: updated };
}
