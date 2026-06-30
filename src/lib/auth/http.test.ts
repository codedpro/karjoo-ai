/**
 * تست‌های واحدِ لایه‌ی چسبِ HTTPِ احراز هویت (`@/lib/auth/http`) — منطقِ خالصِ
 * درخواست/راستی‌آزماییِ OTP، نشست، نرخ، و پیدا/ساختِ کاربر. زمان/تصادف/DB/پیامک
 * کاملاً تزریق و کنترل می‌شوند؛ بدون شبکه و بدون DB زنده.
 *
 * توجه: توابعِ کوکی‌محور (setSessionCookie/getCurrentUser از کوکی) به `next/headers`
 * وابسته‌اند و در تستِ handler (http-routes.test.ts) با mock پوشش داده می‌شوند؛ اینجا
 * فقط منطقِ تزریق‌پذیر تست می‌شود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authSessions, otpCodes, users } from "@/db/schema";
import { hashOtp, type AuthDb } from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMIT_MAX,
  checkOtpRateLimit,
  findOrCreateUserByPhone,
  getUserFromToken,
  logoutByToken,
  publicUser,
  requestOtp,
  resetOtpRateLimit,
  verifyOtpAndLogin,
} from "@/lib/auth/http";
import type { SendOtpOptions, SendOtpResult } from "@/lib/auth/sms";

const PEPPER = "test-pepper-0123456789abcdef";
const PHONE = "+989121234567";

/** نگاشتِ ستونِ هر جدول (snake → camel) برای DBِ جعلی. */
const SESSION_COLS = {
  token_hash: "tokenHash",
  revoked_at: "revokedAt",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
};
const OTP_COLS = {
  id: "id",
  phone: "phone",
  code_hash: "codeHash",
  consumed_at: "consumedAt",
  expires_at: "expiresAt",
  attempts: "attempts",
  created_at: "createdAt",
};
const USER_COLS = {
  id: "id",
  phone: "phone",
  is_active: "isActive",
};

function makeDb(): { db: AuthDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb()
    .register(authSessions, SESSION_COLS)
    .register(otpCodes, OTP_COLS)
    .register(users, USER_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

function fixedBytes(fill: number) {
  return (size: number) => Buffer.alloc(size, fill);
}

/** پیامکِ ساختگیِ موفق (هرگز شبکه نمی‌زند). امضا برای تایپِ صحیحِ mock.calls. */
const okSms = vi.fn<(phone: string, code: string, opts?: SendOtpOptions) => Promise<SendOtpResult>>(
  async () => ({ ok: true, mode: "dev_mode" }),
);

beforeEach(() => {
  resetOtpRateLimit();
  okSms.mockClear();
});

describe("checkOtpRateLimit", () => {
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

describe("requestOtp", () => {
  it("یک کدِ هش‌شده ذخیره می‌کند و پیامک می‌زند (هرگز کدِ خام در DB)", async () => {
    const { db, fake } = makeDb();
    const res = await requestOtp(PHONE, {
      db,
      now: () => 10_000,
      pepper: PEPPER,
      sendOtp: okSms,
    });

    expect(res.sms.ok).toBe(true);
    expect(okSms).toHaveBeenCalledTimes(1);
    const sentCode = okSms.mock.calls[0][1];
    expect(sentCode).toMatch(/^\d{6}$/);

    const stored = fake.rows(otpCodes)[0];
    expect(stored.phone).toBe(PHONE);
    expect(stored.codeHash).toBe(hashOtp(sentCode, PEPPER));
    // کدِ خام نباید هیچ‌جای ردیف باشد.
    expect(Object.values(stored)).not.toContain(sentCode);
    expect(stored.purpose).toBe("login");
  });
});

describe("verifyOtpAndLogin", () => {
  /** یک OTP معتبر می‌سازد و کدِ خام را برمی‌گرداند. */
  async function seedOtp(db: AuthDb, now: number, code = "123456") {
    await db
      .insert(otpCodes)
      .values({
        phone: PHONE,
        codeHash: hashOtp(code, PEPPER),
        purpose: "login",
        attempts: 0, // پیش‌فرضِ schema در Postgres؛ فیکسچرِ تست پیش‌فرض را اعمال نمی‌کند.
        expiresAt: new Date(now + 5 * 60_000),
      })
      .returning();
    return code;
  }

  it("کدِ درست → کاربر ساخته/پیدا و نشستِ web صادر می‌شود", async () => {
    const { db, fake } = makeDb();
    const now = () => 1_000;
    const code = await seedOtp(db, 1_000);

    const out = await verifyOtpAndLogin(PHONE, code, {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(1),
      userAgent: "ua-test",
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.user.phone).toBe(PHONE);
    expect(out.session.token.length).toBeGreaterThan(0);
    expect(out.session.sessionRow.kind).toBe("web");
    expect(out.session.sessionRow.userAgent).toBe("ua-test");
    // کاربر در DB ساخته شده.
    expect(fake.rows(users)).toHaveLength(1);
    // کد مصرف شده (consumedAt ست شده).
    expect(fake.rows(otpCodes)[0].consumedAt).not.toBeNull();
  });

  it("کاربرِ موجود دوباره ساخته نمی‌شود (یکتاییِ شماره)", async () => {
    const { db, fake } = makeDb();
    await db.insert(users).values({ phone: PHONE }).returning();
    const code = await seedOtp(db, 1_000);

    const out = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(2),
    });

    expect(out.ok).toBe(true);
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("بدونِ هیچ کدی → no_code", async () => {
    const { db } = makeDb();
    const out = await verifyOtpAndLogin(PHONE, "123456", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
    });
    expect(out).toEqual({ ok: false, reason: "no_code" });
  });

  it("کدِ منقضی‌شده → expired", async () => {
    const { db } = makeDb();
    const code = await seedOtp(db, 1_000);
    const out = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000 + 10 * 60_000, // بعد از TTL
      pepper: PEPPER,
    });
    expect(out).toEqual({ ok: false, reason: "expired" });
  });

  it("کدِ غلط → mismatch و افزایشِ attempts", async () => {
    const { db, fake } = makeDb();
    await seedOtp(db, 1_000, "123456");
    const out = await verifyOtpAndLogin(PHONE, "000000", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
    });
    expect(out).toEqual({ ok: false, reason: "mismatch" });
    expect(fake.rows(otpCodes)[0].attempts).toBe(1);
    // کد مصرف نشده (هنوز قابلِ تلاشِ مجدد تا سقف).
    expect(fake.rows(otpCodes)[0].consumedAt ?? null).toBeNull();
  });

  it("پس از عبور از سقفِ تلاش → too_many_attempts", async () => {
    const { db, fake } = makeDb();
    await seedOtp(db, 1_000, "123456");
    // attempts را روی سقف ست کن.
    fake.rows(otpCodes)[0].attempts = OTP_MAX_ATTEMPTS;
    const out = await verifyOtpAndLogin(PHONE, "123456", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
    });
    expect(out).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("کدِ مصرف‌شده دوباره کار نمی‌کند (یک‌بارمصرف)", async () => {
    const { db } = makeDb();
    const code = await seedOtp(db, 1_000);
    const first = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(3),
    });
    expect(first.ok).toBe(true);
    const second = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(4),
    });
    // کدِ مصرف‌شده دیگر در جست‌وجوی «مصرف‌نشده» نمی‌آید → no_code.
    expect(second).toEqual({ ok: false, reason: "no_code" });
  });

  it("فقط جدیدترین کدِ مصرف‌نشده بررسی می‌شود", async () => {
    const { db, fake } = makeDb();
    // کدِ قدیمی‌تر «000000» و جدیدتر «123456».
    await seedOtp(db, 900, "000000");
    await seedOtp(db, 1_000, "123456");
    // createdAt را قطعی کن (فیکسچر آن را به wall-clock می‌گذارد؛ برای قطعیتِ تست،
    // صریح ست می‌کنیم تا «جدیدترین» مبهم/flaky نباشد).
    fake.rows(otpCodes)[0].createdAt = new Date(900);
    fake.rows(otpCodes)[1].createdAt = new Date(1_000);

    // کدِ قدیمی نباید بپذیرد (جدیدترین انتخاب می‌شود).
    const oldTry = await verifyOtpAndLogin(PHONE, "000000", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
    });
    expect(oldTry.ok).toBe(false);

    const newTry = await verifyOtpAndLogin(PHONE, "123456", {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(5),
    });
    expect(newTry.ok).toBe(true);
  });
});

describe("getUserFromToken", () => {
  it("توکنِ معتبر → کاربرِ فعال", async () => {
    const { db } = makeDb();
    const code = "123456";
    await db
      .insert(otpCodes)
      .values({
        phone: PHONE,
        codeHash: hashOtp(code, PEPPER),
        purpose: "login",
        expiresAt: new Date(1_000 + 5 * 60_000),
      })
      .returning();
    const login = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(6),
    });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const user = await getUserFromToken(login.session.token, {
      db,
      now: () => 2_000,
      pepper: PEPPER,
    });
    expect(user?.phone).toBe(PHONE);
  });

  it("توکنِ نامعتبر/خالی → null", async () => {
    const { db } = makeDb();
    expect(await getUserFromToken(null, { db, pepper: PEPPER })).toBeNull();
    expect(await getUserFromToken("nope", { db, now: () => 1, pepper: PEPPER })).toBeNull();
  });

  it("کاربرِ غیرفعال → null", async () => {
    const { db, fake } = makeDb();
    const code = "123456";
    await db
      .insert(otpCodes)
      .values({
        phone: PHONE,
        codeHash: hashOtp(code, PEPPER),
        purpose: "login",
        expiresAt: new Date(1_000 + 5 * 60_000),
      })
      .returning();
    const login = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(7),
    });
    if (!login.ok) throw new Error("login should succeed");
    // کاربر را غیرفعال کن.
    fake.rows(users)[0].isActive = false;

    const user = await getUserFromToken(login.session.token, {
      db,
      now: () => 2_000,
      pepper: PEPPER,
    });
    expect(user).toBeNull();
  });
});

describe("logoutByToken", () => {
  it("نشستِ معتبر را باطل می‌کند؛ سپس توکن دیگر کاربر نمی‌دهد", async () => {
    const { db } = makeDb();
    const code = "123456";
    await db
      .insert(otpCodes)
      .values({
        phone: PHONE,
        codeHash: hashOtp(code, PEPPER),
        purpose: "login",
        expiresAt: new Date(1_000 + 5 * 60_000),
      })
      .returning();
    const login = await verifyOtpAndLogin(PHONE, code, {
      db,
      now: () => 1_000,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(8),
    });
    if (!login.ok) throw new Error("login should succeed");

    const revoked = await logoutByToken(login.session.token, {
      db,
      now: () => 1_500,
      pepper: PEPPER,
    });
    expect(revoked).toBe(true);

    const after = await getUserFromToken(login.session.token, {
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

describe("findOrCreateUserByPhone", () => {
  it("بارِ اول می‌سازد و بارِ دوم همان را برمی‌گرداند", async () => {
    const { db, fake } = makeDb();
    const a = await findOrCreateUserByPhone(PHONE, { db });
    const b = await findOrCreateUserByPhone(PHONE, { db });
    expect(a.id).toBe(b.id);
    expect(fake.rows(users)).toHaveLength(1);
  });
});

describe("publicUser", () => {
  it("فقط فیلدهای غیرحساس را برمی‌گرداند", () => {
    const out = publicUser({
      id: "u1",
      phone: PHONE,
      fullName: null,
      plan: "payg",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(out).toEqual({ id: "u1", phone: PHONE, fullName: null });
  });
});
