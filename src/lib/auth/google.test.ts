/**
 * تست‌های واحدِ هسته‌ی «ورود با Google» (`@/lib/auth/google`) — بدونِ شبکه‌ی زنده.
 *
 * fetch کاملاً تزریق می‌شود: یک fake که درخواستِ رسیده را ضبط و پاسخِ کَند برمی‌گرداند.
 * هرگز شبکه‌ای زده نمی‌شود؛ همه‌ی مسیرهای موفقیت/شکست پوشش داده می‌شوند.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_DEFAULT_SCOPE,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  GoogleOAuthError,
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUser,
  type FetchLike,
} from "@/lib/auth/google";

const REDIRECT = "https://karjooai.itmaster.uk/api/auth/callback/google";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret";

/** یک Response جعلیِ سبک از یک شیِ JSON. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/* ─────────────────────────  buildGoogleAuthUrl  ──────────────────────────── */

describe("buildGoogleAuthUrl", () => {
  it("URLِ رضایتِ Google را با همه‌ی پارامترهای لازم می‌سازد", () => {
    const url = new URL(
      buildGoogleAuthUrl("state-xyz", REDIRECT, { clientId: CLIENT_ID }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    const p = url.searchParams;
    expect(p.get("client_id")).toBe(CLIENT_ID);
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe(GOOGLE_DEFAULT_SCOPE);
    expect(p.get("access_type")).toBe("online");
    expect(p.get("prompt")).toBe("select_account");
    expect(p.get("state")).toBe("state-xyz");
  });

  it("اسکوپِ سفارشی را رعایت می‌کند", () => {
    const url = new URL(
      buildGoogleAuthUrl("s", REDIRECT, { clientId: CLIENT_ID, scope: "openid email" }),
    );
    expect(url.searchParams.get("scope")).toBe("openid email");
  });

  it("state را به‌درستی encode می‌کند (کاراکترهای خاص)", () => {
    const raw = "a b/c?d=e&f";
    const url = new URL(buildGoogleAuthUrl(raw, REDIRECT, { clientId: CLIENT_ID }));
    // پس از parse باید دقیقاً همان مقدارِ خام برگردد (encode/decode درست).
    expect(url.searchParams.get("state")).toBe(raw);
  });
});

/* ─────────────────────────  exchangeCodeForTokens  ───────────────────────── */

describe("exchangeCodeForTokens", () => {
  it("کد را با توکن تبادل می‌کند و POSTِ درستی می‌زند", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ access_token: "at-123", id_token: "id-456" }),
    );

    const tokens = await exchangeCodeForTokens("auth-code", REDIRECT, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    });

    expect(tokens).toEqual({ accessToken: "at-123", idToken: "id-456" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(init?.method).toBe("POST");
    // بدنه‌ی form-urlencoded شاملِ همه‌ی فیلدهای لازم.
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("id_token اختیاری است (فقط accessToken)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ access_token: "at-only" }),
    );
    const tokens = await exchangeCodeForTokens("c", REDIRECT, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    });
    expect(tokens).toEqual({ accessToken: "at-only" });
  });

  it("پاسخِ غیرموفق → GoogleOAuthError(token_exchange_failed) با status", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ error: "invalid_grant" }, 400),
    );
    await expect(
      exchangeCodeForTokens("bad", REDIRECT, {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "GoogleOAuthError",
      code: "token_exchange_failed",
      status: 400,
    });
  });

  it("نبودِ access_token → GoogleOAuthError(no_access_token)", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({ id_token: "x" }));
    await expect(
      exchangeCodeForTokens("c", REDIRECT, {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "no_access_token" });
  });

  it("خطای شبکه → GoogleOAuthError(token_exchange_failed) بدونِ status", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("network down");
    });
    const err = await exchangeCodeForTokens("c", REDIRECT, {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect(err.code).toBe("token_exchange_failed");
    expect(err.status).toBeUndefined();
    // پیام هرگز نباید رازی (کد/سکرت) داشته باشد.
    expect(err.message).not.toContain(CLIENT_SECRET);
    expect(err.message).not.toContain("network down");
  });
});

/* ────────────────────────────  fetchGoogleUser  ──────────────────────────── */

describe("fetchGoogleUser", () => {
  it("پروفایلِ کاربر را می‌خواند و access token را در هدرِ Bearer می‌فرستد", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({
        sub: "google-sub-1",
        email: "user@example.com",
        email_verified: true,
        name: "Ali",
        picture: "https://img/avatar.png",
      }),
    );

    const user = await fetchGoogleUser("at-123", { fetchImpl });
    expect(user).toEqual({
      sub: "google-sub-1",
      email: "user@example.com",
      emailVerified: true,
      name: "Ali",
      picture: "https://img/avatar.png",
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_USERINFO_ENDPOINT);
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer at-123");
  });

  it("email_verified رشته‌ای 'true' هم پذیرفته می‌شود؛ name/picture اختیاری‌اند", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse({ sub: "s", email: "e@e.com", email_verified: "true" }),
    );
    const user = await fetchGoogleUser("at", { fetchImpl });
    expect(user).toEqual({ sub: "s", email: "e@e.com", emailVerified: true });
  });

  it("پاسخِ غیرموفق → GoogleOAuthError(userinfo_failed) با status", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, 401));
    await expect(fetchGoogleUser("at", { fetchImpl })).rejects.toMatchObject({
      code: "userinfo_failed",
      status: 401,
    });
  });

  it("نبودِ sub یا email → GoogleOAuthError(invalid_userinfo)", async () => {
    const noSub = vi.fn<FetchLike>(async () => jsonResponse({ email: "e@e.com" }));
    await expect(fetchGoogleUser("at", { fetchImpl: noSub })).rejects.toMatchObject({
      code: "invalid_userinfo",
    });

    const noEmail = vi.fn<FetchLike>(async () => jsonResponse({ sub: "s" }));
    await expect(fetchGoogleUser("at", { fetchImpl: noEmail })).rejects.toMatchObject({
      code: "invalid_userinfo",
    });
  });

  it("خطای شبکه → GoogleOAuthError(userinfo_failed) بدونِ نشتِ توکن", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new Error("boom");
    });
    const err = await fetchGoogleUser("super-secret-token", { fetchImpl }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect(err.code).toBe("userinfo_failed");
    expect(err.message).not.toContain("super-secret-token");
  });
});
