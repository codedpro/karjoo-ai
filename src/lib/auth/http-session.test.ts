/**
 * تست‌های واحدِ بخشِ «نشست + محدودساز نرخ» در لایه‌ی چسبِ HTTPِ احراز هویت
 * (`@/lib/auth/http`): راستی‌آزماییِ نشست از توکن، خروج (ابطال)، و محدودساز نرخِ
 * درون‌حافظه‌ای (بازاستفاده‌شده برای اندپوینتِ شروعِ جریانِ OAuth).
 *
 * هویتِ کاربر با «ورود با Google» ساخته می‌شود (findOrCreateUserByGoogle)؛ نشست با
 * `issueSession` صادر می‌شود. زمان/تصادف/DB کاملاً تزریق و کنترل می‌شوند — بدون شبکه و
 * بدون DB زنده. توابعِ کوکی‌محور (setSessionCookie/getCurrentUser از کوکی) در تستِ
 * handler (auth-routes.test.ts) با mock پوشش داده می‌شوند.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { authSessions, users } from "@/db/schema";
import { issueSession, type AuthDb } from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";
import {
  OTP_RATE_LIMIT_MAX,
  checkOtpRateLimit,
  findOrCreateUserByGoogle,
  getUserFromToken,
  logoutByToken,
  resetOtpRateLimit,
} from "@/lib/auth/http";

const PEPPER = "test-pepper-0123456789abcdef";

/** نگاشتِ ستونِ auth_sessions (snake → camel) برای DBِ جعلی. */
const SESSION_COLS = {
  token_hash: "tokenHash",
  revoked_at: "revokedAt",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
};

/** نگاشتِ ستونِ users (snake → camel) — هویتِ Google. */
const USER_COLS = {
  id: "id",
  google_sub: "googleSub",
  email: "email",
  is_active: "isActive",
};

function makeDb(): { db: AuthDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb()
    .register(authSessions, SESSION_COLS)
    .register(users, USER_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

/** تولیدِ بایتِ تصادفیِ قطعی برای تستِ توکن. */
function fixedBytes(fill: number) {
  return (size: number) => Buffer.alloc(size, fill);
}

const IDENTITY = { sub: "google-sub-1", email: "user@example.com", name: "Ali" };

beforeEach(() => {
  resetOtpRateLimit();
});

describe("checkOtpRateLimit (محدودساز نرخِ اندپوینتِ شروعِ OAuth)", () => {
  it("تا سقف اجازه می‌دهد و سپس مسدود می‌کند", () => {
    const now = 1_000;
    for (let i = 0; i < OTP_RATE_LIMIT_MAX; i++) {
      expect(checkOtpRateLimit("k", now)).toBe(true);
    }
    expect(checkOtpRateLimit("k", now)).toBe(false);
  });

  it("پس از پنجره دوباره باز می‌شود", () => {
    expect(checkOtpRateLimit("k2", 1_000, 1, 100)).toBe(true);
    expect(checkOtpRateLimit("k2", 1_050, 1, 100)).toBe(false);
    expect(checkOtpRateLimit("k2", 1_200, 1, 100)).toBe(true);
  });

  it("کلیدهای متفاوت سطل‌های جدا دارند", () => {
    expect(checkOtpRateLimit("a", 1, 1, 100)).toBe(true);
    expect(checkOtpRateLimit("b", 1, 1, 100)).toBe(true);
  });
});

describe("getUserFromToken", () => {
  it("توکنِ معتبر → کاربرِ فعال", async () => {
    const { db } = makeDb();
    const user = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    const { token } = await issueSession(user.id, "web", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(6),
    });

    const found = await getUserFromToken(token, {
      db,
      now: () => 2_000,
      pepper: PEPPER,
    });
    expect(found?.id).toBe(user.id);
    expect(found?.email).toBe(IDENTITY.email);
  });

  it("توکنِ نامعتبر/خالی → null", async () => {
    const { db } = makeDb();
    expect(await getUserFromToken(null, { db, pepper: PEPPER })).toBeNull();
    expect(await getUserFromToken("nope", { db, now: () => 1, pepper: PEPPER })).toBeNull();
  });

  it("کاربرِ غیرفعال → null", async () => {
    const { db, fake } = makeDb();
    const user = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    const { token } = await issueSession(user.id, "web", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(7),
    });
    // کاربر را غیرفعال کن.
    fake.rows(users)[0].isActive = false;

    const found = await getUserFromToken(token, {
      db,
      now: () => 2_000,
      pepper: PEPPER,
    });
    expect(found).toBeNull();
  });
});

describe("logoutByToken", () => {
  it("نشستِ معتبر را باطل می‌کند؛ سپس توکن دیگر کاربر نمی‌دهد", async () => {
    const { db } = makeDb();
    const user = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    const { token } = await issueSession(user.id, "web", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(8),
    });

    const revoked = await logoutByToken(token, {
      db,
      now: () => 1_500,
      pepper: PEPPER,
    });
    expect(revoked).toBe(true);

    const after = await getUserFromToken(token, {
      db,
      now: () => 2_000,
      pepper: PEPPER,
    });
    expect(after).toBeNull();
  });

  it("توکنِ null/نامعتبر → false (idempotent)", async () => {
    const { db } = makeDb();
    expect(await logoutByToken(null, { db, pepper: PEPPER })).toBe(false);
    expect(await logoutByToken("nope", { db, now: () => 1, pepper: PEPPER })).toBe(false);
  });
});
