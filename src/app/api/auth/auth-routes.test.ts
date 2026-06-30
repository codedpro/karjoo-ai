/**
 * تست‌های route handlerهای احراز هویت (/api/auth/*).
 *
 * استراتژی: لایه‌ی منطق (`@/lib/auth/http`, `@/lib/auth/pairing`) و کوکی‌ها
 * (`next/headers`) mock می‌شوند تا فقط «سیم‌کشیِ HTTP» تستِ شود: کدِ وضعیتِ درست،
 * نشاندن/پاک‌کردنِ کوکی، پاسخِ عمومیِ یکسان، و گاردِ احراز هویت. بدون DB/شبکه.
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

/* ─────────────────────────  mock لایه‌ی منطقِ auth  ──────────────────────── */

vi.mock("@/lib/auth/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/http")>("@/lib/auth/http");
  return {
    ...actual,
    requestOtp: vi.fn(async () => ({ sms: { ok: true, mode: "dev_mode" } })),
    verifyOtpAndLogin: vi.fn(),
    getCurrentUser: vi.fn(),
    logoutByToken: vi.fn(async () => true),
    readSessionToken: vi.fn(async () => "tok"),
    setSessionCookie: vi.fn(async () => {}),
    clearSessionCookie: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/auth/pairing", () => ({
  createPairingCode: vi.fn(),
}));

import * as authHttp from "@/lib/auth/http";
import { createPairingCode } from "@/lib/auth/pairing";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as otpRequestPOST } from "@/app/api/auth/otp/request/route";
import { POST as otpVerifyPOST } from "@/app/api/auth/otp/verify/route";
import { POST as pairPOST } from "@/app/api/auth/extension/pair/route";

const requestOtpMock = vi.mocked(authHttp.requestOtp);
const verifyOtpAndLoginMock = vi.mocked(authHttp.verifyOtpAndLogin);
const getCurrentUserMock = vi.mocked(authHttp.getCurrentUser);
const setSessionCookieMock = vi.mocked(authHttp.setSessionCookie);
const clearSessionCookieMock = vi.mocked(authHttp.clearSessionCookie);
const logoutByTokenMock = vi.mocked(authHttp.logoutByToken);
const createPairingCodeMock = vi.mocked(createPairingCode);

const USER = { id: "u1", phone: "+989121234567", fullName: null, plan: "payg" as const, isActive: true, createdAt: new Date(), updatedAt: new Date() };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "ua-test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authHttp.resetOtpRateLimit();
});

describe("POST /api/auth/otp/request", () => {
  it("ورودیِ معتبر → ۲۰۰ با پاسخِ عمومی و فراخوانیِ requestOtp", async () => {
    const res = await otpRequestPOST(
      jsonRequest("http://x/api/auth/otp/request", { phone: "09121234567" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(requestOtpMock).toHaveBeenCalledTimes(1);
    // شماره نرمال‌شده (E.164) به منطق می‌رسد.
    expect(requestOtpMock.mock.calls[0][0]).toBe("+989121234567");
  });

  it("شماره‌ی نامعتبر → ۴۰۰", async () => {
    const res = await otpRequestPOST(
      jsonRequest("http://x/api/auth/otp/request", { phone: "abc" }),
    );
    expect(res.status).toBe(400);
    expect(requestOtpMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی غیرJSON → ۴۰۰", async () => {
    const bad = new Request("http://x/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await otpRequestPOST(bad);
    expect(res.status).toBe(400);
  });

  it("پس از عبور از سقفِ نرخ، دیگر پیامک نمی‌فرستد ولی همان پاسخِ عمومی را می‌دهد", async () => {
    const url = "http://x/api/auth/otp/request";
    for (let i = 0; i < authHttp.OTP_RATE_LIMIT_MAX; i++) {
      const r = await otpRequestPOST(jsonRequest(url, { phone: "09121234567" }));
      expect(r.status).toBe(200);
    }
    // درخواستِ بعدی: مسدودِ نرخ → requestOtp صدا نمی‌خورد ولی پاسخ ۲۰۰ عمومی است.
    const blocked = await otpRequestPOST(jsonRequest(url, { phone: "09121234567" }));
    expect(blocked.status).toBe(200);
    expect((await blocked.json()).ok).toBe(true);
    expect(requestOtpMock).toHaveBeenCalledTimes(authHttp.OTP_RATE_LIMIT_MAX);
  });
});

describe("POST /api/auth/otp/verify", () => {
  it("کدِ درست → ۲۰۰، کوکی نشانده می‌شود، کاربر برمی‌گردد", async () => {
    verifyOtpAndLoginMock.mockResolvedValueOnce({
      ok: true,
      user: USER,
      session: { token: "raw-token", sessionRow: {} as never },
    });
    const res = await otpVerifyPOST(
      jsonRequest("http://x/api/auth/otp/verify", { phone: "09121234567", code: "123456" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: "u1", phone: "+989121234567", fullName: null });
    // کوکیِ نشست با توکنِ خام نشانده شد.
    expect(setSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(setSessionCookieMock.mock.calls[0][0]).toBe("raw-token");
    // userAgent از هدر به منطق رسید.
    expect(verifyOtpAndLoginMock.mock.calls[0][2]).toMatchObject({ userAgent: "ua-test" });
  });

  it("کدِ غلط → ۴۰۱ عمومی، بدونِ کوکی", async () => {
    verifyOtpAndLoginMock.mockResolvedValueOnce({ ok: false, reason: "mismatch" });
    const res = await otpVerifyPOST(
      jsonRequest("http://x/api/auth/otp/verify", { phone: "09121234567", code: "000000" }),
    );
    expect(res.status).toBe(401);
    expect(setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("کدِ بدشکل → ۴۰۰", async () => {
    const res = await otpVerifyPOST(
      jsonRequest("http://x/api/auth/otp/verify", { phone: "09121234567", code: "x" }),
    );
    expect(res.status).toBe(400);
    expect(verifyOtpAndLoginMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/logout", () => {
  it("همیشه ۲۰۰ و کوکی را پاک می‌کند (idempotent)", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(200);
    expect(logoutByTokenMock).toHaveBeenCalledTimes(1);
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/auth/me", () => {
  it("نشستِ معتبر → کاربر", async () => {
    getCurrentUserMock.mockResolvedValueOnce(USER);
    const res = await meGET();
    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({ id: "u1", phone: "+989121234567", fullName: null });
  });

  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);
    const res = await meGET();
    expect(res.status).toBe(401);
  });
});

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
