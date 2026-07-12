/**
 * تست‌های واحدِ بخشِ «ورود با Google» در لایه‌ی HTTP (`@/lib/auth/http`):
 *   • findOrCreateUserByGoogle — پیدا با googleSub، fallback با email، ساختِ تازه، به‌روزرسانیِ پروفایل.
 *   • گرهِ best-effort به استخرِ 1xai (linkOnexai) — فقط وقتی onexaiUserId خالی است؛ شکستش ورود را نمی‌شکند.
 *   • publicUser — شکلِ جدید (id/email/name/avatarUrl، بدونِ phone).
 *
 * DB کاملاً تزریق می‌شود (FakeAuthDb)؛ بدونِ شبکه/DB زنده. `linkOnexai` هم همیشه تزریق
 * می‌شود تا هیچ تستی به ensureOnexaiLink واقعی (و از آن‌جا به /svcِ 1xai) نرسد.
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
  onexai_user_id: "onexaiUserId",
  onexai_api_key: "onexaiApiKey",
};

function makeDb(): { db: AuthDb; fake: FakeAuthDb } {
  const fake = new FakeAuthDb().register(users, USER_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

/** linkOnexaiِ بی‌اثر — تا هیچ تستی سراغِ /svcِ واقعی نرود. */
const noLink = async () => {};

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
    const user = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 1_000,
      linkOnexai: noLink,
    });

    expect(user.googleSub).toBe(IDENTITY.sub);
    expect(user.email).toBe(IDENTITY.email);
    expect(user.name).toBe(IDENTITY.name);
    expect(user.avatarUrl).toBe(IDENTITY.avatarUrl);
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("بارِ دوم همان کاربر را با googleSub پیدا می‌کند (نه ساختِ دوباره)", async () => {
    const { db, fake } = makeDb();
    const a = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 1_000,
      linkOnexai: noLink,
    });
    const b = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 2_000,
      linkOnexai: noLink,
    });
    expect(a.id).toBe(b.id);
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("name/avatar را در هر ورود به‌روزرسانی می‌کند", async () => {
    const { db, fake } = makeDb();
    await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 1_000, linkOnexai: noLink });
    const updated = await findOrCreateUserByGoogle(
      { ...IDENTITY, name: "Ali New", avatarUrl: "https://img/b.png" },
      { db, now: () => 2_000, linkOnexai: noLink },
    );
    expect(updated.name).toBe("Ali New");
    expect(updated.avatarUrl).toBe("https://img/b.png");
    expect(fake.rows(users)).toHaveLength(1);
  });

  it("fallback با email: کاربرِ موجودِ بدونِ googleSub را گره می‌زند (نه ساختِ دوباره)", async () => {
    const { db, fake } = makeDb();
    // کاربری که قبلاً فقط با ایمیل شناخته شده (googleSub خالی).
    await db.insert(users).values({ email: IDENTITY.email }).returning();

    const user = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 1_000,
      linkOnexai: noLink,
    });
    expect(fake.rows(users)).toHaveLength(1);
    expect(user.googleSub).toBe(IDENTITY.sub);
    expect(user.email).toBe(IDENTITY.email);
    expect(user.name).toBe(IDENTITY.name);
  });

  it("name/avatar نداشته باشد → null ذخیره می‌شود (بدونِ خطا)", async () => {
    const { db } = makeDb();
    const user = await findOrCreateUserByGoogle(
      { sub: "s2", email: "e2@e.com" },
      { db, now: () => 1_000, linkOnexai: noLink },
    );
    expect(user.googleSub).toBe("s2");
    expect(user.name ?? null).toBeNull();
    expect(user.avatarUrl ?? null).toBeNull();
  });

  it("کاربرِ بدونِ گره (onexaiUserId خالی) → linkOnexai در هر ورود صدا زده می‌شود", async () => {
    const { db } = makeDb();
    const calls: string[] = [];
    const linkOnexai = async (userId: string) => {
      calls.push(userId);
    };

    const created = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 5_000,
      linkOnexai,
    });
    expect(calls).toEqual([created.id]);

    // ورودِ دوم — گره هنوز برقرار نشده (linkِ تستی چیزی ذخیره نمی‌کند) → دوباره تلاش.
    await findOrCreateUserByGoogle(IDENTITY, { db, now: () => 6_000, linkOnexai });
    expect(calls).toEqual([created.id, created.id]);
  });

  it("کاربرِ از‌پیش‌گره‌خورده (onexaiUserId پُر) → linkOnexai صدا زده نمی‌شود", async () => {
    const { db } = makeDb();
    await db
      .insert(users)
      .values({ googleSub: IDENTITY.sub, email: IDENTITY.email, onexaiUserId: 42 })
      .returning();
    const calls: string[] = [];

    await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 1_000,
      linkOnexai: async (userId) => {
        calls.push(userId);
      },
    });
    expect(calls).toHaveLength(0);
  });

  it("شکستِ گره به 1xai ورود را نمی‌شکند (best-effort)", async () => {
    const { db, fake } = makeDb();
    const user = await findOrCreateUserByGoogle(IDENTITY, {
      db,
      now: () => 1_000,
      linkOnexai: async () => {
        throw new Error("1xai down");
      },
    });
    // با وجودِ شکستِ گره، کاربر ساخته و برگردانده می‌شود.
    expect(user.googleSub).toBe(IDENTITY.sub);
    expect(fake.rows(users)).toHaveLength(1);
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
      onexaiUserId: null,
      onexaiApiKey: null,
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
    // و هرگز نباید کلید/شناسه‌ی 1xai فاش شود.
    expect(out).not.toHaveProperty("onexaiApiKey");
    expect(out).not.toHaveProperty("onexaiUserId");
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
      onexaiUserId: null,
      onexaiApiKey: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(out).toEqual({ id: "u2", email: null, name: null, avatarUrl: null });
  });
});
