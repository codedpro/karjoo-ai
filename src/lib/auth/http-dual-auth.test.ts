/**
 * تست‌های `getCurrentUserOrBearer` — مرزِ احراز هویتِ «کوکیِ وب **یا** Bearerِ افزونه».
 *
 * چرا مهم است: افزونه از `chrome-extension://` صدا می‌زند و هرگز کوکیِ هم‌مبدأ نمی‌فرستد،
 * پس مسیرهای مشترک (auto-apply / find-jobs / me-plan) باید Bearer را هم بپذیرند. این تست
 * تضمین می‌کند پذیرشِ Bearer **هیچ مسیرِ ضعیف‌تری** باز نکرده باشد: همان راستی‌آزماییِ
 * نشست و همان ردِ کاربرِ غیرفعال باید روی هر دو مسیر اعمال شود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authSessions, users } from "@/db/schema";
import { issueSession, type AuthDb } from "@/lib/auth/core";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";

/** کوکی‌استورِ قابلِ‌کنترل — پیش‌فرض: هیچ کوکیِ نشستی (حالتِ افزونه). */
let cookieValue: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "karjoo_session" && cookieValue ? { value: cookieValue } : undefined),
  }),
}));

const { getCurrentUserOrBearer, findOrCreateUserByGoogle } = await import("@/lib/auth/http");

const PEPPER = "test-pepper-0123456789abcdef";
const SESSION_COLS = {
  token_hash: "tokenHash",
  revoked_at: "revokedAt",
  expires_at: "expiresAt",
  id: "id",
  user_id: "userId",
};
const USER_COLS = { id: "id", google_sub: "googleSub", email: "email", is_active: "isActive" };

function makeDb() {
  const fake = new FakeAuthDb().register(authSessions, SESSION_COLS).register(users, USER_COLS);
  return { db: fake as unknown as AuthDb, fake };
}

const now = () => new Date("2026-08-06T12:00:00.000Z").getTime();

/** یک کاربر + نشستِ معتبرِ افزونه می‌سازد و { userId, token } را برمی‌گرداند. */
async function seedUserWithSession(
  db: AuthDb,
  { sub = "g1", fill = 7 }: { sub?: string; fill?: number } = {},
) {
  const user = await findOrCreateUserByGoogle(
    { sub, email: `${sub}@example.com` },
    { db, now },
  );
  const { token } = await issueSession(user.id, "extension", {
    db,
    now,
    pepper: PEPPER,
    randomBytesImpl: (size: number) => Buffer.alloc(size, fill),
  });
  return { userId: user.id, token };
}

const reqWithBearer = (token: string) =>
  new Request("https://karjoo.1xai.ir/api/auto-apply", {
    headers: { authorization: `Bearer ${token}` },
  });

describe("getCurrentUserOrBearer — cookie OR bearer", () => {
  beforeEach(() => {
    cookieValue = null;
  });

  it("authenticates an extension caller that sends ONLY a Bearer token (no cookie)", async () => {
    const { db } = makeDb();
    const { userId, token } = await seedUserWithSession(db);

    const user = await getCurrentUserOrBearer(reqWithBearer(token), { db, now, pepper: PEPPER });

    expect(user?.id).toBe(userId);
  });

  it("authenticates a web caller via the cookie when there is no Authorization header", async () => {
    const { db } = makeDb();
    const { userId, token } = await seedUserWithSession(db);
    cookieValue = token;

    const user = await getCurrentUserOrBearer(
      new Request("https://karjoo.1xai.ir/api/auto-apply"),
      { db, now, pepper: PEPPER },
    );

    expect(user?.id).toBe(userId);
  });

  it("returns null when neither a cookie nor a Bearer token is present", async () => {
    const { db } = makeDb();

    const user = await getCurrentUserOrBearer(
      new Request("https://karjoo.1xai.ir/api/auto-apply"),
      { db, now, pepper: PEPPER },
    );

    expect(user).toBeNull();
  });

  it("rejects a bogus Bearer token (no weaker path than the cookie)", async () => {
    const { db } = makeDb();
    await seedUserWithSession(db);

    const user = await getCurrentUserOrBearer(reqWithBearer("not-a-real-token"), {
      db,
      now,
      pepper: PEPPER,
    });

    expect(user).toBeNull();
  });

  it("rejects a DEACTIVATED user over Bearer, exactly like the cookie path", async () => {
    const { db, fake } = makeDb();
    const { token } = await seedUserWithSession(db);
    fake.rows(users)[0]!.isActive = false;

    expect(await getCurrentUserOrBearer(reqWithBearer(token), { db, now, pepper: PEPPER })).toBeNull();

    cookieValue = token;
    expect(
      await getCurrentUserOrBearer(new Request("https://karjoo.1xai.ir/api/auto-apply"), {
        db,
        now,
        pepper: PEPPER,
      }),
    ).toBeNull();
  });

  it("rejects an EXPIRED session over Bearer", async () => {
    const { db } = makeDb();
    const { token } = await seedUserWithSession(db);
    // ۹۱ روز بعد — نشستِ افزونه (۹۰ روزه) منقضی شده است.
    const later = () => now() + 91 * 24 * 60 * 60 * 1000;

    const user = await getCurrentUserOrBearer(reqWithBearer(token), {
      db,
      now: later,
      pepper: PEPPER,
    });

    expect(user).toBeNull();
  });

  it("uses the cookie FIRST — a valid cookie authenticates even with a garbage Bearer header", async () => {
    const { db } = makeDb();
    const { userId, token } = await seedUserWithSession(db);
    cookieValue = token;

    const user = await getCurrentUserOrBearer(reqWithBearer("garbage-token"), {
      db,
      now,
      pepper: PEPPER,
    });

    expect(user?.id).toBe(userId);
  });
});
