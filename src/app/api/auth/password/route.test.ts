/**
 * تست‌های POST /api/auth/password — ورود با ایمیل/گذرواژه‌ی استخرِ مشترکِ 1xai.
 *
 * استراتژی (همانِ auth-routes.test.ts): لایه‌های منطق mock می‌شوند تا فقط «سیم‌کشیِ HTTP»
 * تست شود — کدِ وضعیت، پیامِ یکنواختِ ۴۰۱، ۵۰۳ی fail-closed، محدودسازِ نرخ، و صدورِ
 * *همان* نشستِ وبِ مسیرِ Google (issueSession + setSessionCookie). DB با FakeAuthDb
 * تزریق می‌شود؛ verifyPoolPassword mock است — بدونِ شبکه/DB زنده.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ─────────────────────────────  mock کوکی‌ها  ───────────────────────────── */

const cookieStore = {
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

/* ─────────────────  mock DB (FakeAuthDb، تزریق با holder)  ─────────────── */

// vi.mock hoist می‌شود؛ holder با vi.hoisted پیش از importها ساخته می‌شود و در
// beforeEach یک FakeAuthDbِ تازه می‌گیرد (جداسازیِ بین تست‌ها).
const dbHolder = vi.hoisted(() => ({
  current: null as unknown as {
    select: (...a: unknown[]) => unknown;
    insert: (...a: unknown[]) => unknown;
    update: (...a: unknown[]) => unknown;
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbHolder.current.select(...a),
    insert: (...a: unknown[]) => dbHolder.current.insert(...a),
    update: (...a: unknown[]) => dbHolder.current.update(...a),
  },
}));

/* ────────────────────  mock لایه‌ی منطق (core/http/svc)  ──────────────────── */

vi.mock("@/lib/auth/core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/core")>("@/lib/auth/core");
  return {
    ...actual,
    issueSession: vi.fn(async () => ({ token: "raw-token", sessionRow: {} as never })),
  };
});

vi.mock("@/lib/auth/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/http")>("@/lib/auth/http");
  return {
    ...actual,
    setSessionCookie: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/onexai/svc", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/onexai/svc")>("@/lib/onexai/svc");
  return {
    ...actual,
    verifyPoolPassword: vi.fn(),
  };
});

import * as authCore from "@/lib/auth/core";
import * as authHttp from "@/lib/auth/http";
import { OnexaiSvcUnavailableError, verifyPoolPassword } from "@/lib/onexai/svc";
import { users } from "@/db/schema";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";
import { resetRateLimits } from "@/lib/api/rate-limit";
import {
  PASSWORD_RATE_LIMIT_MAX,
  POST as passwordPOST,
} from "@/app/api/auth/password/route";

const issueSessionMock = vi.mocked(authCore.issueSession);
const setSessionCookieMock = vi.mocked(authHttp.setSessionCookie);
const verifyPoolPasswordMock = vi.mocked(verifyPoolPassword);

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

let fake: FakeAuthDb;

/** یک POST Request با بدنه‌ی JSON (و IPِ ثابت برای محدودساز). */
function postRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://x/api/auth/password", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "ua-test",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  fake = new FakeAuthDb().register(users, USER_COLS);
  dbHolder.current = fake as unknown as typeof dbHolder.current;
});

describe("POST /api/auth/password", () => {
  it("اعتبارِ درست + کاربرِ محلیِ ناموجود → ساختِ کاربرِ گره‌خورده و نشستِ وب (۲۰۰)", async () => {
    verifyPoolPasswordMock.mockResolvedValueOnce({ id: 42, email: "user@example.com" });

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "secret" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // کاربرِ محلی ساخته و به شناسه‌ی استخر گره خورد.
    const rows = fake.rows(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("user@example.com");
    expect(rows[0].onexaiUserId).toBe(42);

    // *همان* نشستِ وبِ مسیرِ Google: issueSession('web') + کوکی با توکنِ خام.
    expect(issueSessionMock).toHaveBeenCalledTimes(1);
    expect(issueSessionMock.mock.calls[0][0]).toBe(rows[0].id);
    expect(issueSessionMock.mock.calls[0][1]).toBe("web");
    expect(setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(setSessionCookieMock.mock.calls[0][0]).toBe("raw-token");
  });

  it("ایمیل نرمال می‌شود (trim/lowercase) و به verifyPoolPassword همان می‌رسد", async () => {
    verifyPoolPasswordMock.mockResolvedValueOnce({ id: 1, email: "a@b.co" });

    const res = await passwordPOST(
      postRequest({ email: "  A@B.Co ", password: "secret" }),
    );

    expect(res.status).toBe(200);
    expect(verifyPoolPasswordMock).toHaveBeenCalledWith("a@b.co", "secret");
  });

  it("کاربرِ محلیِ موجود با onexaiUserId خالی → شناسه‌ی استخر تثبیت می‌شود (نه ساختِ دوباره)", async () => {
    await fake.insert(users).values({ email: "user@example.com" }).returning();
    verifyPoolPasswordMock.mockResolvedValueOnce({ id: 77, email: "user@example.com" });

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "secret" }),
    );

    expect(res.status).toBe(200);
    const rows = fake.rows(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].onexaiUserId).toBe(77);
  });

  it("کاربرِ از‌پیش‌گره‌خورده → دست‌نخورده می‌ماند و نشست صادر می‌شود", async () => {
    await fake
      .insert(users)
      .values({ email: "user@example.com", onexaiUserId: 5 })
      .returning();
    verifyPoolPasswordMock.mockResolvedValueOnce({ id: 5, email: "user@example.com" });

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "secret" }),
    );

    expect(res.status).toBe(200);
    expect(fake.rows(users)[0].onexaiUserId).toBe(5);
    expect(issueSessionMock).toHaveBeenCalledTimes(1);
  });

  it("اعتبارِ نادرست (verifyPoolPassword → null) → ۴۰۱ با پیامِ یکنواخت، بدونِ نشست", async () => {
    verifyPoolPasswordMock.mockResolvedValueOnce(null);

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "wrong" }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("ایمیل یا گذرواژه نادرست است");
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    // هیچ کاربرِ محلی‌ای ساخته نمی‌شود.
    expect(fake.rows(users)).toHaveLength(0);
  });

  it("کاربرِ غیرفعال (isActive=false) → همان ۴۰۱ یکنواخت، بدونِ نشست", async () => {
    await fake
      .insert(users)
      .values({ email: "user@example.com", onexaiUserId: 9, isActive: false })
      .returning();
    verifyPoolPasswordMock.mockResolvedValueOnce({ id: 9, email: "user@example.com" });

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "secret" }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("ایمیل یا گذرواژه نادرست است");
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("1xai در دسترس نیست (OnexaiSvcUnavailableError) → ۵۰۳ fail-closed", async () => {
    verifyPoolPasswordMock.mockRejectedValueOnce(new OnexaiSvcUnavailableError());

    const res = await passwordPOST(
      postRequest({ email: "user@example.com", password: "secret" }),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("ورود با گذرواژه موقتاً در دسترس نیست");
    expect(issueSessionMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی نامعتبر (بدونِ password / ایمیلِ خراب / فیلدِ اضافه) → ۴۰۰، بدونِ verify", async () => {
    for (const body of [
      { email: "user@example.com" },
      { email: "not-an-email", password: "x" },
      { email: "user@example.com", password: "x", extra: 1 },
    ]) {
      const res = await passwordPOST(postRequest(body));
      expect(res.status).toBe(400);
    }
    expect(verifyPoolPasswordMock).not.toHaveBeenCalled();
  });

  it("عبور از سقفِ نرخ → ۴۲۹ با Retry-After، بدونِ verify", async () => {
    verifyPoolPasswordMock.mockResolvedValue(null);

    for (let i = 0; i < PASSWORD_RATE_LIMIT_MAX; i++) {
      const r = await passwordPOST(
        postRequest({ email: "user@example.com", password: "wrong" }),
      );
      expect(r.status).toBe(401);
    }

    verifyPoolPasswordMock.mockClear();
    const blocked = await passwordPOST(
      postRequest({ email: "user@example.com", password: "wrong" }),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(verifyPoolPasswordMock).not.toHaveBeenCalled();
  });
});
