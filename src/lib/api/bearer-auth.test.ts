/**
 * تست‌های واحدِ نگهبانِ Bearer (`@/lib/api/bearer-auth`) — بدون DB/شبکه‌ی زنده.
 *
 * تابعِ راستی‌آزماییِ نشست تزریق می‌شود (هسته‌ی auth mock)؛ فقط منطقِ استخراجِ توکن،
 * fail-closed و اعمالِ requireKind تست می‌شود.
 */
import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/api/http";
import {
  extractBearerToken,
  requireBearerSession,
  type VerifySessionFn,
} from "@/lib/api/bearer-auth";
import type { AuthSession } from "@/db/schema";

/** ساختِ یک Request با هدرِ Authorization اختیاری. */
function req(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("https://karjoo.app/api/extension/me", { headers });
}

/** نشستِ ساختگی برای خروجیِ verify. */
function fakeSession(kind: "web" | "extension", userId = "user-1"): AuthSession {
  return {
    id: "sess-1",
    userId,
    tokenHash: "hash",
    kind,
    userAgent: null,
    expiresAt: new Date(Date.now() + 1_000_000),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
  };
}

describe("extractBearerToken", () => {
  it("توکن را از `Bearer <token>` می‌کشد", () => {
    expect(extractBearerToken(req("Bearer abc.def-123"))).toBe("abc.def-123");
  });

  it("به کلیدواژه‌ی Bearer حساس به حروف بزرگ/کوچک نیست", () => {
    expect(extractBearerToken(req("bearer XYZ"))).toBe("XYZ");
  });

  it("نبودِ هدر → null", () => {
    expect(extractBearerToken(req())).toBeNull();
  });

  it("قالبِ بدشکل (بدونِ Bearer) → null", () => {
    expect(extractBearerToken(req("Token abc"))).toBeNull();
    expect(extractBearerToken(req("abc"))).toBeNull();
    expect(extractBearerToken(req("Bearer "))).toBeNull();
  });
});

describe("requireBearerSession", () => {
  const okVerify: VerifySessionFn = async (token) =>
    token === "good" ? { userId: "user-1", session: fakeSession("extension") } : null;

  it("توکنِ معتبر (کاربرِ فعال) → نشست", async () => {
    const s = await requireBearerSession(req("Bearer good"), {
      verify: okVerify,
      loadUserActive: async () => true,
    });
    expect(s.userId).toBe("user-1");
  });

  it("کاربرِ غیرفعال/بن‌شده (isActive=false) → ۴۰۱ حتی با توکنِ معتبر", async () => {
    await expect(
      requireBearerSession(req("Bearer good"), {
        verify: okVerify,
        loadUserActive: async () => false,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("کاربرِ یافت‌نشده (loader → null) → ۴۰۱ (fail-closed)", async () => {
    await expect(
      requireBearerSession(req("Bearer good"), {
        verify: okVerify,
        loadUserActive: async () => null,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("نبودِ هدر → HttpError(401)", async () => {
    await expect(requireBearerSession(req(), { verify: okVerify })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("توکنِ نامعتبر → HttpError(401)", async () => {
    await expect(
      requireBearerSession(req("Bearer bad"), { verify: okVerify }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("requireKind='extension' و نشستِ web → 401", async () => {
    const webVerify: VerifySessionFn = async () => ({
      userId: "u",
      session: fakeSession("web"),
    });
    await expect(
      requireBearerSession(req("Bearer good"), {
        verify: webVerify,
        requireKind: "extension",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requireKind='extension' و نشستِ extension → قبول", async () => {
    const s = await requireBearerSession(req("Bearer good"), {
      verify: okVerify,
      requireKind: "extension",
      loadUserActive: async () => true,
    });
    expect(s.session.kind).toBe("extension");
  });

  it("بدونِ requireKind، نشستِ web هم قبول می‌شود", async () => {
    const webVerify: VerifySessionFn = async () => ({
      userId: "u",
      session: fakeSession("web"),
    });
    const s = await requireBearerSession(req("Bearer good"), {
      verify: webVerify,
      loadUserActive: async () => true,
    });
    expect(s.session.kind).toBe("web");
  });
});
