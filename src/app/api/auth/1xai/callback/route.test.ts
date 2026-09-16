/**
 * تست‌های GET /api/auth/1xai/callback — «ورود با حسابِ 1xAi» با بلیتِ یک‌بارمصرف.
 * مثلِ تستِ مسیرِ گذرواژه: DB جعلی، نشست و svc mock (بدونِ شبکه/DB زنده).
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
    redeemPoolSsoTicket: vi.fn(),
  };
});

import * as authCore from "@/lib/auth/core";
import * as authHttp from "@/lib/auth/http";
import { OnexaiSvcUnavailableError, redeemPoolSsoTicket } from "@/lib/onexai/svc";
import { users } from "@/db/schema";
import { FakeAuthDb } from "@/lib/auth/__fixtures__/fake-db";
import { GET as callbackGET } from "@/app/api/auth/1xai/callback/route";
import { safeNextPath } from "@/lib/auth/safe-next";

const issueSessionMock = vi.mocked(authCore.issueSession);
const setSessionCookieMock = vi.mocked(authHttp.setSessionCookie);
const redeemMock = vi.mocked(redeemPoolSsoTicket);

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

function callback(query: string): Request {
  return new Request(`http://x/api/auth/1xai/callback?${query}`, {
    headers: { "user-agent": "ua-test" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = new FakeAuthDb().register(users, USER_COLS);
  dbHolder.current = fake as unknown as typeof dbHolder.current;
});

describe("GET /api/auth/1xai/callback", () => {
  it("بلیتِ معتبر → ساختِ کاربرِ گره‌خورده، نشستِ وب و رفتن به next", async () => {
    redeemMock.mockResolvedValueOnce({ id: 31, email: "Dev@Example.com" });

    const res = await callbackGET(callback("ticket=abc&next=%2Fdashboard%2Fplans"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard/plans");
    const rows = fake.rows(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("dev@example.com");
    expect(rows[0].onexaiUserId).toBe(31);
    expect(issueSessionMock.mock.calls[0][1]).toBe("web");
    expect(setSessionCookieMock.mock.calls[0][0]).toBe("raw-token");
  });

  it("کاربرِ موجود با همان شناسه‌ی 1xai دوباره ساخته نمی‌شود", async () => {
    await fake.insert(users).values({ email: "old@example.com", onexaiUserId: 31, isActive: true }).returning();
    redeemMock.mockResolvedValueOnce({ id: 31, email: "new@example.com" });

    await callbackGET(callback("ticket=abc"));

    const rows = fake.rows(users);
    expect(rows).toHaveLength(1);
    expect(issueSessionMock.mock.calls[0][0]).toBe(rows[0].id);
  });

  it("بلیتِ نامعتبر/مصرف‌شده → /login?error=onexai بدونِ نشست", async () => {
    redeemMock.mockResolvedValueOnce(null);
    const res = await callbackGET(callback("ticket=used"));
    expect(res.headers.get("location")).toBe("/login?error=onexai");
    expect(issueSessionMock).not.toHaveBeenCalled();
  });

  it("بدونِ بلیت → بدونِ تماس با 1xai", async () => {
    const res = await callbackGET(callback("next=%2Fdashboard"));
    expect(res.headers.get("location")).toBe("/login?error=onexai");
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it("کاربرِ غیرفعال نشست نمی‌گیرد", async () => {
    await fake.insert(users).values({ email: "x@example.com", onexaiUserId: 7, isActive: false }).returning();
    redeemMock.mockResolvedValueOnce({ id: 7, email: "x@example.com" });
    const res = await callbackGET(callback("ticket=abc"));
    expect(res.headers.get("location")).toBe("/login?error=onexai");
    expect(issueSessionMock).not.toHaveBeenCalled();
  });

  it("1xai در دسترس نیست → onexai_unavailable", async () => {
    redeemMock.mockRejectedValueOnce(new OnexaiSvcUnavailableError("down"));
    const res = await callbackGET(callback("ticket=abc"));
    expect(res.headers.get("location")).toBe("/login?error=onexai_unavailable");
  });

  it("next به دامنه‌ی دیگر → /dashboard", async () => {
    redeemMock.mockResolvedValueOnce({ id: 1, email: "a@example.com" });
    const res = await callbackGET(callback("ticket=abc&next=https%3A%2F%2Fevil.example"));
    expect(res.headers.get("location")).toBe("/dashboard");
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/dashboard/jobs?q=1", "/dashboard/jobs?q=1"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["dashboard", "/dashboard"],
    ["/a\nb", "/dashboard"],
    ["", "/dashboard"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input.replace("\\n", "\n"))).toBe(expected);
  });

  it("null → پیش‌فرض", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});
