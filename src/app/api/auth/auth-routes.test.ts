/**
 * تست‌های route handlerهای احراز هویت (/api/auth/*).
 *
 * استراتژی: لایه‌ی منطق (`@/lib/auth/http`, `@/lib/auth/core`, `@/lib/auth/google`,
 * `@/lib/auth/pairing`, `@/lib/env`) و کوکی‌ها (`next/headers`) mock می‌شوند تا فقط
 * «سیم‌کشیِ HTTP» تست شود: کدِ وضعیت/هدرِ redirect درست، نشاندن/پاک‌کردنِ کوکی، راستی‌آزماییِ
 * state (CSRF)، و گاردِ احراز هویت. بدون DB/شبکه.
 *
 * پوششِ ورود با Google:
 *   • GET /api/auth/google        — نشاندنِ کوکیِ state + 302 به URLِ رضایتِ Google.
 *   • GET /api/auth/google        — پیکربندی‌نشده → 302 /login?error=oauth_unconfigured.
 *   • GET /api/auth/callback/...   — مسیرِ خوشحال: state معتبر → نشست + 302 /dashboard.
 *   • GET /api/auth/callback/...   — عدمِ تطابقِ state → 302 /login?error=state.
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

/* ────────────────────  mock لایه‌ی منطقِ auth (http/core)  ────────────────── */

vi.mock("@/lib/auth/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/http")>("@/lib/auth/http");
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    logoutByToken: vi.fn(async () => true),
    readSessionToken: vi.fn(async () => "tok"),
    setSessionCookie: vi.fn(async () => {}),
    clearSessionCookie: vi.fn(async () => {}),
    findOrCreateUserByGoogle: vi.fn(),
  };
});

vi.mock("@/lib/auth/core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/core")>("@/lib/auth/core");
  return {
    ...actual,
    issueSession: vi.fn(async () => ({ token: "raw-token", sessionRow: {} as never })),
  };
});

vi.mock("@/lib/auth/google", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/google")>("@/lib/auth/google");
  return {
    ...actual,
    buildGoogleAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?mock=1"),
    exchangeCodeForTokens: vi.fn(async () => ({ accessToken: "at" })),
    fetchGoogleUser: vi.fn(async () => ({
      sub: "google-sub-1",
      email: "user@example.com",
      emailVerified: true,
      name: "Ali Test",
      picture: "https://img/a.png",
    })),
  };
});

vi.mock("@/lib/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return {
    ...actual,
    isGoogleOAuthConfigured: vi.fn(() => true),
    requireGoogleOAuth: vi.fn(() => ({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://karjooai.itmaster.uk/api/auth/google/callback",
    })),
  };
});

vi.mock("@/lib/auth/pairing", () => ({
  createPairingCode: vi.fn(),
}));

import * as authHttp from "@/lib/auth/http";
import * as authCore from "@/lib/auth/core";
import * as authGoogle from "@/lib/auth/google";
import * as appEnv from "@/lib/env";
import { createPairingCode } from "@/lib/auth/pairing";
import { GoogleOAuthError } from "@/lib/auth/google";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as pairPOST } from "@/app/api/auth/extension/pair/route";
import {
  GET as googleStartGET,
  OAUTH_STATE_COOKIE,
} from "@/app/api/auth/google/route";
import { GET as googleCallbackGET } from "@/app/api/auth/google/callback/route";

const getCurrentUserMock = vi.mocked(authHttp.getCurrentUser);
const setSessionCookieMock = vi.mocked(authHttp.setSessionCookie);
const clearSessionCookieMock = vi.mocked(authHttp.clearSessionCookie);
const logoutByTokenMock = vi.mocked(authHttp.logoutByToken);
const findOrCreateUserByGoogleMock = vi.mocked(authHttp.findOrCreateUserByGoogle);
const issueSessionMock = vi.mocked(authCore.issueSession);
const buildGoogleAuthUrlMock = vi.mocked(authGoogle.buildGoogleAuthUrl);
const exchangeCodeForTokensMock = vi.mocked(authGoogle.exchangeCodeForTokens);
const fetchGoogleUserMock = vi.mocked(authGoogle.fetchGoogleUser);
const isGoogleOAuthConfiguredMock = vi.mocked(appEnv.isGoogleOAuthConfigured);
const createPairingCodeMock = vi.mocked(createPairingCode);

/** کاربرِ نمونه با شکلِ جدیدِ schema (هویتِ Google، بدونِ phone). */
const USER = {
  id: "u1",
  googleSub: "google-sub-1",
  email: "user@example.com",
  name: "Ali Test",
  avatarUrl: "https://img/a.png",
  phone: null,
  fullName: null,
  plan: "free" as const,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as import("@/db/schema").User;

/** یک GET Request با هدرها (user-agent برای رصدِ نشست). */
function getRequest(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: { "user-agent": "ua-test", "x-forwarded-for": "203.0.113.7" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authHttp.resetOtpRateLimit();
  // پیش‌فرض‌های mock (بعضی تست‌ها override می‌کنند).
  isGoogleOAuthConfiguredMock.mockReturnValue(true);
  cookieStore.get.mockReturnValue(undefined);
});

/* ─────────────────────────  GET /api/auth/google  ────────────────────────── */

describe("GET /api/auth/google (شروعِ جریانِ OAuth)", () => {
  it("کوکیِ state را می‌نشاند و به URLِ رضایتِ Google هدایت می‌کند (302)", async () => {
    const res = await googleStartGET(getRequest("http://x/api/auth/google"));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
    );

    // کوکیِ state (httpOnly، کوتاه‌عمر) نشانده شد.
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieStore.set.mock.calls[0];
    expect(name).toBe(OAUTH_STATE_COOKIE);
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });

    // همان stateِ کوکی به سازنده‌ی URL منتقل شد (تا در callback مقایسه شود).
    expect(buildGoogleAuthUrlMock).toHaveBeenCalledTimes(1);
    expect(buildGoogleAuthUrlMock.mock.calls[0][0]).toBe(value);
  });

  it("پیکربندی‌نشده → 302 /login?error=oauth_unconfigured و کوکیِ state نمی‌نشیند", async () => {
    isGoogleOAuthConfiguredMock.mockReturnValue(false);
    const res = await googleStartGET(getRequest("http://x/api/auth/google"));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth_unconfigured");
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(buildGoogleAuthUrlMock).not.toHaveBeenCalled();
  });

  it("پس از عبور از سقفِ نرخِ per-IP → 302 /login?error=rate_limited", async () => {
    const url = "http://x/api/auth/google";
    for (let i = 0; i < authHttp.OTP_RATE_LIMIT_MAX; i++) {
      const r = await googleStartGET(getRequest(url));
      expect(r.status).toBe(302);
      expect(r.headers.get("Location")).not.toContain("error=rate_limited");
    }
    const blocked = await googleStartGET(getRequest(url));
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get("Location")).toContain("/login?error=rate_limited");
  });
});

/* ─────────────────────  GET /api/auth/google/callback  ───────────────────── */

describe("GET /api/auth/google/callback (بازگشت از Google)", () => {
  it("state معتبر → نشست صادر و کوکی نشانده می‌شود، 302 /dashboard", async () => {
    cookieStore.get.mockReturnValue({ value: "state-abc" });
    findOrCreateUserByGoogleMock.mockResolvedValueOnce(USER);

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?code=the-code&state=state-abc"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/dashboard");

    // تبادلِ کد + خواندنِ پروفایل + پیدا/ساختِ کاربر.
    expect(exchangeCodeForTokensMock).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForTokensMock.mock.calls[0][0]).toBe("the-code");
    expect(fetchGoogleUserMock).toHaveBeenCalledTimes(1);
    expect(findOrCreateUserByGoogleMock).toHaveBeenCalledTimes(1);
    expect(findOrCreateUserByGoogleMock.mock.calls[0][0]).toMatchObject({
      sub: "google-sub-1",
      email: "user@example.com",
      name: "Ali Test",
      avatarUrl: "https://img/a.png",
    });

    // نشستِ وب صادر و کوکیِ نشست با توکنِ خام نشانده شد.
    expect(issueSessionMock).toHaveBeenCalledTimes(1);
    expect(issueSessionMock.mock.calls[0][0]).toBe("u1");
    expect(issueSessionMock.mock.calls[0][1]).toBe("web");
    expect(setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(setSessionCookieMock.mock.calls[0][0]).toBe("raw-token");

    // کوکیِ state (یک‌بارمصرف) پاک شد.
    expect(cookieStore.delete).toHaveBeenCalledWith(OAUTH_STATE_COOKIE);
  });

  it("عدمِ تطابقِ state → 302 /login?error=state، بدونِ نشست", async () => {
    cookieStore.get.mockReturnValue({ value: "state-abc" });

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?code=the-code&state=WRONG"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=state");
    // هیچ تبادلِ توکن/نشستی رخ نمی‌دهد.
    expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
    // کوکیِ state حتی در مسیرِ خطا هم پاک می‌شود (یک‌بارمصرف).
    expect(cookieStore.delete).toHaveBeenCalledWith(OAUTH_STATE_COOKIE);
  });

  it("نبودِ کوکیِ state → 302 /login?error=state", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?code=the-code&state=state-abc"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=state");
    expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
  });

  it("پیکربندی‌نشده → 302 /login?error=oauth_unconfigured", async () => {
    isGoogleOAuthConfiguredMock.mockReturnValue(false);

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?code=c&state=s"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth_unconfigured");
  });

  it("GoogleOAuthError هنگامِ تبادلِ توکن → 302 /login?error=oauth، بدونِ نشست", async () => {
    cookieStore.get.mockReturnValue({ value: "state-abc" });
    exchangeCodeForTokensMock.mockRejectedValueOnce(
      new GoogleOAuthError("token_exchange_failed", "boom", 400),
    );

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?code=the-code&state=state-abc"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth");
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("نبودِ code (رد رضایت) با stateِ معتبر → 302 /login?error=oauth", async () => {
    cookieStore.get.mockReturnValue({ value: "state-abc" });

    const res = await googleCallbackGET(
      getRequest("http://x/api/auth/google/callback?state=state-abc&error=access_denied"),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/login?error=oauth");
    expect(exchangeCodeForTokensMock).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────  POST /api/auth/logout  ────────────────────── */

describe("POST /api/auth/logout", () => {
  it("همیشه ۲۰۰ و کوکی را پاک می‌کند (idempotent)", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(logoutByTokenMock).toHaveBeenCalledTimes(1);
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
  });
});

/* ────────────────────────────  GET /api/auth/me  ─────────────────────────── */

describe("GET /api/auth/me", () => {
  it("نشستِ معتبر → کاربر (شکلِ جدید: id/email/name/avatarUrl)", async () => {
    getCurrentUserMock.mockResolvedValueOnce(USER);
    const res = await meGET();
    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({
      id: "u1",
      email: "user@example.com",
      name: "Ali Test",
      avatarUrl: "https://img/a.png",
    });
  });

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const res = await meGET();
    expect(res.status).toBe(401);
  });
});

/* ──────────────────────  POST /api/auth/extension/pair  ──────────────────── */

describe("POST /api/auth/extension/pair", () => {
  it("کاربرِ احرازشده → کدِ جفت‌سازی + انقضا", async () => {
    getCurrentUserMock.mockResolvedValueOnce(USER);
    const expiresAt = new Date("2026-01-01T00:00:00.000Z");
    createPairingCodeMock.mockResolvedValueOnce({
      code: "pairing-code",
      link: { expiresAt } as never,
    });
    const res = await pairPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pairingCode).toBe("pairing-code");
    expect(body.expiresAt).toBe(expiresAt.toISOString());
    expect(createPairingCodeMock.mock.calls[0][0]).toBe("u1");
  });

  it("بدونِ نشست → ۴۰۱ و کدی ساخته نمی‌شود", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const res = await pairPOST();
    expect(res.status).toBe(401);
    expect(createPairingCodeMock).not.toHaveBeenCalled();
  });
});
