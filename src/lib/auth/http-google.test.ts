/**
 * تست‌های واحدِ بخشِ «ورود با Google» در لایه‌ی HTTP (`@/lib/auth/http`):
 *   • findOrCreateUserByGoogle — پیدا با googleSub، fallback با email، ساختِ تازه، به‌روزرسانیِ پروفایل.
 *   • publicUser — شکلِ جدید (id/email/name/avatarUrl، بدونِ phone).
 *
 * DB کاملاً تزریق می‌شود (FakeAuthDb)؛ بدونِ شبکه/DB زنده.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import type { AuthDb } from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";
import { findOrCreateUserByGoogle, publicUser, resetOtpRateLimit } from "@/lib/auth/http";

/** نگاشتِ ستونِ users (snake → camel) برای DBِ جعلی. */
const USER_COLS = {
  id: "id",
  google_sub: "googleSub",
  email: "email",
  name: "name",
  avatar_url: "avatarUrl",
  is_active: "isActive",
};

function makeDb(): { db: AuthDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb().register(users, USER_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

const IDENTITY = {
  sub: "google-sub-1",
  email: "user@example.com",
  name: "Ali Test",
  avatarUrl: "https://img/a.png",
};

beforeEach(() => {
  resetOtpRateLimit();
});

describe("findOrCreateUserByGoogle", () => {
  it("بارِ اول کاربر را می‌سازد (googleSub + email + name + avatar)", async () => {
    const { db, fake } = makeDb();
    const user = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });

    expect(user.googleSub).toBe(IDENTITY.sub);
    expect(user.email).toBe(IDENTITY.email);
    expect(user.name).toBe(IDENTITY.name);
    expect(user.avatarUrl).toBe(IDENTITY.avatarUrl);
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("بارِ دوم همان کاربر را با googleSub پیدا می‌کند (نه ساختِ دوباره)", async () => {
    const { db, fake } = makeDb();
    const a = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    const b = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 2_000 });
    expect(a.id).toBe(b.id);
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("name/avatar را در هر ورود به‌روزرسانی می‌کند", async () => {
    const { db, fake } = makeDb();
    await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    const updated = await findOrCreateUserByGoogle(
      { ...IDENTITY, name: "Ali New", avatarUrl: "https://img/b.png" },
      { db, now: () => 2_000 },
    );
    expect(updated.name).toBe("Ali New");
    expect(updated.avatarUrl).toBe("https://img/b.png");
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("fallback با email: کاربرِ موجودِ بدونِ googleSub را گره می‌زند (نه ساختِ دوباره)", async () => {
    const { db, fake } = makeDb();
    // کاربری که قبلاً فقط با ایمیل شناخته شده (googleSub خالی).
    await db.insert(users).values({ email: IDENTITY.email }).returning();

    const user = await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000 });
    expect(fake.rows(users)).toHaveLength(1);
    expect(user.googleSub).toBe(IDENTITY.sub);
    expect(user.email).toBe(IDENTITY.email);
    expect(user.name).toBe(IDENTITY.name);
  });

  it("name/avatar نداشته باشد → null ذخیره می‌شود (بدونِ خطا)", async () => {
    const { db } = makeDb();
    const user = await findOrCreateUserByGoogle(
      { sub: "s2", email: "e2@e.com" },
      { db, now: () => 1_000 },
    );
    expect(user.googleSub).toBe("s2");
    expect(user.name ?? null).toBeNull();
    expect(user.avatarUrl ?? null).toBeNull();
  });
});

describe("publicUser", () => {
  it("فقط فیلدهای غیرحساسِ Google را برمی‌گرداند (بدونِ phone)", () => {
    const out = publicUser({
      id: "u1",
      googleSub: "sub",
      email: "e@e.com",
      name: "Ali",
      avatarUrl: "https://img/a.png",
      phone: null,
      fullName: null,
      plan: "free",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(out).toEqual({
      id: "u1",
      email: "e@e.com",
      name: "Ali",
      avatarUrl: "https://img/a.png",
    });
    // هرگز نباید phone فاش شود.
    expect(out).not.toHaveProperty("phone");
  });

  it("فیلدهای خالی → null", () => {
    const out = publicUser({
      id: "u2",
      googleSub: null,
      email: null,
      name: null,
      avatarUrl: null,
      phone: null,
      fullName: null,
      plan: "free",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(out).toEqual({ id: "u2", email: null, name: null, avatarUrl: null });
  });
});
