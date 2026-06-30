/**
 * تست‌های واحدِ هندآفِ اتصالِ دستگاه (pairing) — بدون شبکه/DB زنده، زمان/تصادف کنترل‌شده.
 *
 * قاعده‌ی کلیدی (CONTEXT ۵): redeem یک نشستِ 'extension' می‌سازد، بدون OTP دوم، و
 * کدِ جفت‌سازی یک‌بارمصرف است.
 */
import { describe, expect, it } from "vitest";

import { authSessions, deviceLinks } from "@/db/schema";
import { type AuthDb } from "@/lib/auth/core";
import {
  PAIRING_TTL_MS,
  createPairingCode,
  redeemPairingCode,
  type PairingDb,
} from "@/lib/auth/pairing";
import { hashWithPepper } from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";

const PEPPER = "test-pepper-0123456789abcdef";

const SESSION_COLS = {
  token_hash: "tokenHash",
  revoked_at: "revokedAt",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
};
const LINK_COLS = {
  pairing_code_hash: "pairingCodeHash",
  status: "status",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
  linked_session_id: "linkedSessionId",
};

function makeDb(): { db: PairingDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb()
    .register(authSessions, SESSION_COLS)
    .register(deviceLinks, LINK_COLS);
  return { db: fake as unknown as PairingDb, fake };
}

function fixedBytes(fill: number) {
  return (size: number) => Buffer.alloc(size, fill);
}

describe("createPairingCode", () => {
  it("کدِ خام را برمی‌گرداند ولی فقط هشش را با وضعیتِ pending ذخیره می‌کند", async () => {
    const { db, fake } = makeDb();
    const now = () => 10_000;
    const { code, link } = await createPairingCode("user-1", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(8),
    });

    expect(code.length).toBeGreaterThan(0);
    const stored = fake.rows(deviceLinks)[0];
    expect(stored.pairingCodeHash).toBe(hashWithPepper(code, PEPPER));
    expect(Object.values(stored)).not.toContain(code); // کدِ خام ذخیره نشده
    expect(stored.status).toBe("pending");
    expect(link.expiresAt.getTime()).toBe(10_000 + PAIRING_TTL_MS);
  });
});

describe("redeemPairingCode", () => {
  it("یک نشستِ extension می‌سازد و لینک را linked می‌کند (بدون OTP دوم)", async () => {
    const { db, fake } = makeDb();
    const now = () => 1_000;
    const { code } = await createPairingCode("user-7", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(9),
    });

    const redeemed = await redeemPairingCode(code, {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(10),
      userAgent: "KarjooExt/1.0",
    });

    expect(redeemed).not.toBeNull();
    expect(redeemed!.session.sessionRow.kind).toBe("extension");
    expect(redeemed!.session.sessionRow.userId).toBe("user-7");
    expect(redeemed!.session.token.length).toBeGreaterThan(0);
    // لینک به linked رفته و به نشست اشاره می‌کند.
    expect(redeemed!.link.status).toBe("linked");
    expect(redeemed!.link.linkedSessionId).toBe(redeemed!.session.sessionRow.id);
    // یک نشست در DB هست.
    expect(fake.rows(authSessions).length).toBe(1);
  });

  it("یک‌بارمصرف است: redeemِ دوم با همان کد null می‌دهد", async () => {
    const { db } = makeDb();
    const now = () => 1_000;
    const { code } = await createPairingCode("u", {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(11),
    });

    const first = await redeemPairingCode(code, {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(12),
    });
    expect(first).not.toBeNull();

    const second = await redeemPairingCode(code, {
      db,
      now,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(13),
    });
    expect(second).toBeNull();
  });

  it("کدِ منقضی‌شده null می‌دهد و لینک را expired می‌کند", async () => {
    const { db, fake } = makeDb();
    const issuedAt = 1_000;
    const { code } = await createPairingCode("u", {
      db,
      now: () => issuedAt,
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(14),
    });

    const redeemed = await redeemPairingCode(code, {
      db,
      now: () => issuedAt + PAIRING_TTL_MS + 1, // بعد از انقضا
      pepper: PEPPER,
      randomBytesImpl: fixedBytes(15),
    });
    expect(redeemed).toBeNull();
    expect(fake.rows(deviceLinks)[0].status).toBe("expired");
    // هیچ نشستی نباید ساخته شده باشد.
    expect(fake.rows(authSessions).length).toBe(0);
  });

  it("کدِ ناشناخته و رشته‌ی خالی → null", async () => {
    const { db } = makeDb();
    expect(
      await redeemPairingCode("nope", { db, now: () => 1, pepper: PEPPER }),
    ).toBeNull();
    expect(
      await redeemPairingCode("", { db, now: () => 1, pepper: PEPPER }),
    ).toBeNull();
  });
});

// اطمینان از سازگاریِ نوعِ AuthDb و PairingDb (PairingDb باید AuthDb را ارضا کند).
it("نوعِ PairingDb با AuthDb سازگار است", () => {
  const { db } = makeDb();
  const asAuth: AuthDb = db;
  expect(asAuth).toBeDefined();
});
