/**
 * تست‌های واحدِ هسته‌ی auth — زمان/تصادف/DB کاملاً کنترل‌شده، بدون شبکه.
 */
import { describe, expect, it } from "vitest";

import { authSessions } from "@/db/schema";
import {
  EXTENSION_SESSION_TTL_MS,
  WEB_SESSION_TTL_MS,
  generateOtp,
  hashOtp,
  hashWithPepper,
  issueSession,
  revokeSession,
  safeEqualHex,
  verifyOtp,
  verifySessionToken,
  type AuthDb,
} from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";

const PEPPER = "test-pepper-0123456789abcdef";

/** نگاشتِ ستونِ auth_sessions (snake → camel) برای DBِ جعلی. */
const SESSION_COLS = {
  token_hash: "tokenHash",
  revoked_at: "revokedAt",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
};

function makeDb(): { db: AuthDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb().register(authSessions, SESSION_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

/** تولیدِ بایتِ تصادفیِ قطعی برای تستِ توکن. */
function fixedBytes(fill: number) {
  return (size: number) => Buffer.alloc(size, fill);
}

describe("generateOtp", () => {
  it("به‌صورت پیش‌فرض کدِ ۶ رقمی می‌سازد و صفرهای ابتدایی را حفظ می‌کند", () => {
    for (let i = 0; i < 200; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it("طولِ دلخواه را احترام می‌گذارد", () => {
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
  });
});

describe("hashOtp / verifyOtp", () => {
  it("هشِ یکسان برای کدِ یکسان و pepperِ یکسان", () => {
    expect(hashOtp("123456", PEPPER)).toBe(hashOtp("123456", PEPPER));
  });

  it("هشِ متفاوت با pepperِ متفاوت (نقشِ pepper)", () => {
    expect(hashOtp("123456", PEPPER)).not.toBe(hashOtp("123456", "other-pepper-xxxxxxxx"));
  });

  it("verifyOtp برای کدِ درست true و برای غلط false می‌دهد", () => {
    const stored = hashOtp("123456", PEPPER);
    expect(verifyOtp("123456", stored, PEPPER)).toBe(true);
    expect(verifyOtp("000000", stored, PEPPER)).toBe(false);
  });

  it("هرگز کدِ خام را در هش فاش نمی‌کند", () => {
    expect(hashOtp("123456", PEPPER)).not.toContain("123456");
  });
});

describe("safeEqualHex", () => {
  it("برابرها true و نابرابرها/طول‌متفاوت false", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("ab", "abcd")).toBe(false);
  });
});

describe("issueSession", () => {
  it("توکنِ خام را برمی‌گرداند ولی فقط هشش را ذخیره می‌کند", async () => {
    const { db, fake } = makeDb();
    const now = () => 1_000_000;
    const { token, sessionRow } = await issueSession("user-1", "web", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(7),
    });

    expect(token.length).toBeGreaterThan(0);
    // توکنِ خام نباید در ردیفِ ذخیره‌شده باشد؛ فقط هشش.
    const stored = fake.rows(authSessions)[0];
    expect(stored.tokenHash).toBe(hashWithPepper(token, PEPPER));
    expect(Object.values(stored)).not.toContain(token);
    expect(sessionRow.userId).toBe("user-1");
    expect(sessionRow.kind).toBe("web");
  });

  it("TTLِ web و extension را درست اعمال می‌کند", async () => {
    const now = () => 5_000;
    const web = await issueSession("u", "web", {
      db: makeDb().db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(1),
    });
    expect(web.sessionRow.expiresAt.getTime()).toBe(5_000 + WEB_SESSION_TTL_MS);

    const ext = await issueSession("u", "extension", {
      db: makeDb().db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(2),
    });
    expect(ext.sessionRow.expiresAt.getTime()).toBe(5_000 + EXTENSION_SESSION_TTL_MS);
  });
});

describe("verifySessionToken", () => {
  it("توکنِ معتبر را به کاربر نگاشت می‌کند", async () => {
    const { db } = makeDb();
    const now = () => 1_000;
    const { token } = await issueSession("user-9", "web", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(3),
    });

    const verified = await verifySessionToken(token, { db, now: () => 2_000, pepper: PEPPER });
    expect(verified?.userId).toBe("user-9");
  });

  it("توکنِ منقضی‌شده را رد می‌کند (null)", async () => {
    const { db } = makeDb();
    const issuedAt = 1_000;
    const { token } = await issueSession("u", "web", {
      db,
      now: () => issuedAt,
      pepper: PEPPER,
      ttlMs: 1_000,
      randomBytesImpl: fixedBytes(4),
    });
    const verified = await verifySessionToken(token, {
      db,
      now: () => issuedAt + 2_000, // بعد از انقضا
      pepper: PEPPER,
    });
    expect(verified).toBeNull();
  });

  it("توکنِ ناشناخته و رشته‌ی خالی → null", async () => {
    const { db } = makeDb();
    expect(await verifySessionToken("nope", { db, pepper: PEPPER })).toBeNull();
    expect(await verifySessionToken("", { db, pepper: PEPPER })).toBeNull();
  });

  it("نشستِ باطل‌شده دیگر معتبر نیست", async () => {
    const { db } = makeDb();
    const now = () => 1_000;
    const { token, sessionRow } = await issueSession("u", "web", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(5),
    });
    await revokeSession(sessionRow.id, { db, now });
    const verified = await verifySessionToken(token, { db, now: () => 2_000, pepper: PEPPER });
    expect(verified).toBeNull();
  });
});

describe("revokeSession", () => {
  it("بارِ اول true و بارِ دوم false (idempotent)", async () => {
    const { db } = makeDb();
    const now = () => 1_000;
    const { sessionRow } = await issueSession("u", "web", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(6),
    });
    expect(await revokeSession(sessionRow.id, { db, now })).toBe(true);
    expect(await revokeSession(sessionRow.id, { db, now })).toBe(false);
  });

  it("شناسه‌ی ناموجود → false", async () => {
    const { db } = makeDb();
    expect(await revokeSession("missing", { db, now: () => 1 })).toBe(false);
  });
});
