/**
 * Server-side login driver tests.
 *
 * The properties that matter: a rejected credential is classified (never stored),
 * a captcha fails closed instead of being worked around, success is proven against
 * an authenticated endpoint rather than inferred from a redirect, and the password
 * never appears in the session that gets vaulted.
 */
import { describe, expect, it, vi } from "vitest";

import {
  accountLabelFrom,
  classifyLoginPage,
  csrfTokenFrom,
  jobinjaLoginDriver,
} from "@/lib/apply/login/jobinja-login";
import {
  buildTokenEnvelope,
  classifyAuthFailure,
  irantalentLoginDriver,
} from "@/lib/apply/login/irantalent-login";
import { parseSetCookie, CookieJar } from "@/lib/apply/login/cookie-jar";
import { isRetryableLoginFailure } from "@/lib/apply/login/types";

const CREDENTIAL = { username: "user@example.com", password: "s3cret-password" };

function html(body: string) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

const LOGIN_FORM = html(`
  <form action="https://jobinja.ir/login/user" method="POST">
    <input type="hidden" name="_token" value="tok-abc123">
    <input name="identifier"><input type="password" name="password">
  </form>`);

function response(body: string, init: ResponseInit & { url?: string; setCookie?: string[] } = {}) {
  const res = new Response(body, init);
  if (init.setCookie) {
    Object.defineProperty(res.headers, "getSetCookie", { value: () => init.setCookie });
  }
  if (init.url) Object.defineProperty(res, "url", { value: init.url });
  return res;
}

describe("cookie jar", () => {
  it("parses attributes and keeps the newest value", () => {
    const cookie = parseSetCookie(
      "JSESSID=abc; expires=Mon, 31-Aug-2026 18:46:23 GMT; path=/; domain=.jobinja.ir; HttpOnly",
      ".jobinja.ir",
    );
    expect(cookie).toMatchObject({ name: "JSESSID", value: "abc", httpOnly: true, path: "/" });
    expect(cookie?.expirationDate).toBeGreaterThan(0);
  });

  it("drops a cookie the site clears, so a logout is not replayed as a session", () => {
    const jar = new CookieJar(".jobinja.ir");
    jar.absorb(response("", { setCookie: ["JSESSID=abc; path=/"] }));
    expect(jar.has("JSESSID")).toBe(true);
    jar.absorb(response("", { setCookie: ["JSESSID=; path=/"] }));
    expect(jar.has("JSESSID")).toBe(false);
  });

  it("recognizes Jobinja's hashed remember-me cookie by prefix", () => {
    const jar = new CookieJar(".jobinja.ir");
    jar.absorb(response("", { setCookie: ["remember_web_9f8a=xyz; Max-Age=2592000; path=/"] }));
    expect(jar.hasPrefix("remember_")).toBe(true);
    expect(jar.latestExpiry()!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("jobinja login parsing", () => {
  it("finds the CSRF token in the form or the meta tag", () => {
    expect(csrfTokenFrom(LOGIN_FORM)).toBe("tok-abc123");
    expect(csrfTokenFrom(html('<meta name="csrf-token" content="meta-tok">'))).toBe("meta-tok");
    expect(csrfTokenFrom(html("<p>no form</p>"))).toBeNull();
  });

  it("classifies the board's own error pages", () => {
    expect(classifyLoginPage(html("نام کاربری یا رمز عبور اشتباه است"))).toMatchObject({
      reason: "invalid_credentials",
    });
    expect(classifyLoginPage(html('<div class="g-recaptcha"></div>'))).toMatchObject({
      reason: "security_challenge",
    });
    expect(classifyLoginPage(html("Too many attempts"))).toMatchObject({ reason: "rate_limited" });
    expect(classifyLoginPage(html("<p>ok</p>"))).toBeNull();
  });

  it("reads a display name when the page offers one", () => {
    expect(accountLabelFrom(html('<meta name="user-name" content="امیرحسین">'))).toBe("امیرحسین");
    expect(accountLabelFrom(html("<p>nothing</p>"))).toBeUndefined();
  });
});

describe("jobinja login flow", () => {
  function fetcher(steps: { verifyUrl?: string; verifyBody?: string; submitStatus?: number; submitBody?: string }) {
    return vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/login/user") && (init?.method ?? "GET") === "GET") {
        return response(LOGIN_FORM, { setCookie: ["JSESSID=guest; path=/; domain=.jobinja.ir"] });
      }
      if (url.endsWith("/login/user")) {
        return response(steps.submitBody ?? "", {
          status: steps.submitStatus ?? 302,
          setCookie: ["JSESSID=member; path=/; domain=.jobinja.ir", "remember_web_1=keep; Max-Age=2592000"],
        });
      }
      return response(steps.verifyBody ?? html("<div>cv-builder</div>"), {
        url: steps.verifyUrl ?? "https://jobinja.ir/app/cv-builder",
      });
    }) as unknown as typeof fetch;
  }

  it("submits the CSRF token with the credential and vaults the resulting cookies", async () => {
    const fetchMock = fetcher({});
    const result = await jobinjaLoginDriver.login(CREDENTIAL, fetchMock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const posted = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[1]?.method === "POST")!;
    const body = String(posted[1].body);
    expect(body).toContain("_token=tok-abc123");
    expect(body).toContain("remember_me=1");
    // The GET's cookie must ride along, or Laravel rejects the token.
    expect(String(posted[1].headers.cookie)).toContain("JSESSID=guest");

    const bundle = JSON.parse(result.session) as { cookies: { name: string }[] };
    expect(bundle.cookies.map((c) => c.name)).toContain("remember_web_1");
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("never puts the password anywhere in the vaulted session", async () => {
    const result = await jobinjaLoginDriver.login(CREDENTIAL, fetcher({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).not.toContain(CREDENTIAL.password);
    expect(result.session).not.toContain(CREDENTIAL.username);
  });

  it("treats a redirect back to the login page as a rejected credential", async () => {
    const result = await jobinjaLoginDriver.login(
      CREDENTIAL,
      fetcher({ verifyUrl: "https://jobinja.ir/login/user" }),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });

  it("classifies a re-rendered form instead of claiming success", async () => {
    const result = await jobinjaLoginDriver.login(
      CREDENTIAL,
      fetcher({ submitStatus: 200, submitBody: html("نام کاربری یا رمز عبور اشتباه است") }),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });

  it("fails closed on a captcha rather than trying to get around it", async () => {
    const fetchMock = vi.fn(async () =>
      response(html('<div class="g-recaptcha"></div>'))) as unknown as typeof fetch;
    expect(await jobinjaLoginDriver.login(CREDENTIAL, fetchMock)).toMatchObject({
      ok: false,
      reason: "security_challenge",
    });
  });

  it("reports a changed login page instead of guessing", async () => {
    const fetchMock = vi.fn(async () => response(html("<p>redesigned</p>"))) as unknown as typeof fetch;
    expect(await jobinjaLoginDriver.login(CREDENTIAL, fetchMock)).toMatchObject({
      ok: false,
      reason: "provider_changed",
    });
  });

  it("does not crash on a network failure", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await jobinjaLoginDriver.login(CREDENTIAL, fetchMock)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("irantalent login", () => {
  it("builds the same token envelope the site stores in its own cookie", () => {
    const built = buildTokenEnvelope(
      { token_type: "Bearer", access_token: "AT", refresh_token: "RT", expires_in: 3600 },
      1_700_000_000_000,
    )!;
    expect(built.authorization).toBe("Bearer AT");
    expect(JSON.parse(built.envelope)).toMatchObject({
      token_type: "Bearer",
      access_token: "AT",
      refresh_token: "RT",
      created_at: 1_700_000_000_000,
      token_user: "candidate",
    });
    expect(built.expiresAt!.getTime()).toBe(1_700_000_000_000 + 3_600_000);
  });

  it("returns null when the response carries no access token", () => {
    expect(buildTokenEnvelope({ message: "nope" }, Date.now())).toBeNull();
  });

  it("maps the board's real error shapes", () => {
    expect(classifyAuthFailure(403, {
      response_description: "You do not have an account in IranTalent. Please Register to continue.",
    })).toMatchObject({ reason: "invalid_credentials" });
    expect(classifyAuthFailure(401, {})).toMatchObject({ reason: "invalid_credentials" });
    expect(classifyAuthFailure(429, {})).toMatchObject({ reason: "rate_limited" });
    expect(classifyAuthFailure(503, {})).toMatchObject({ reason: "unavailable" });
    expect(classifyAuthFailure(418, {})).toMatchObject({ reason: "provider_changed" });
  });

  it("logs in, proves the token against the profile, and vaults the envelope", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/api-token")) {
        return new Response(JSON.stringify({
          token_type: "Bearer", access_token: "AT", refresh_token: "RT", expires_in: 7200,
        }));
      }
      return new Response(JSON.stringify({ cv: { id: 77 }, user: { first_name: "سارا", surname: "ک" } }));
    }) as unknown as typeof fetch;

    const result = await irantalentLoginDriver.login(CREDENTIAL, fetchMock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountLabel).toBe("سارا ک");
    expect(result.session).not.toContain(CREDENTIAL.password);
    const bundle = JSON.parse(result.session) as { cookies: { name: string; value: string }[] };
    expect(bundle.cookies[0]!.name).toBe("auth_token_irantalent_new");
    expect(JSON.parse(decodeURIComponent(bundle.cookies[0]!.value))).toMatchObject({ access_token: "AT" });
  });

  it("refuses a token the profile endpoint rejects", async () => {
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/auth/api-token")
        ? new Response(JSON.stringify({ token_type: "Bearer", access_token: "AT", expires_in: 10 }))
        : new Response("{}", { status: 401 })) as unknown as typeof fetch;
    expect(await irantalentLoginDriver.login(CREDENTIAL, fetchMock)).toMatchObject({
      ok: false,
      reason: "session_unavailable",
    });
  });

  it("stops when the account has no candidate CV to apply with", async () => {
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/auth/api-token")
        ? new Response(JSON.stringify({ token_type: "Bearer", access_token: "AT", expires_in: 10 }))
        : new Response(JSON.stringify({ user: { email: "a@b.c" } }))) as unknown as typeof fetch;
    expect(await irantalentLoginDriver.login(CREDENTIAL, fetchMock)).toMatchObject({
      ok: false,
      reason: "account_action_required",
    });
  });
});

describe("retry policy", () => {
  it("retries only what a retry can fix", () => {
    expect(isRetryableLoginFailure("rate_limited")).toBe(true);
    expect(isRetryableLoginFailure("unavailable")).toBe(true);
    for (const reason of ["invalid_credentials", "security_challenge", "provider_changed"] as const) {
      expect(isRetryableLoginFailure(reason), reason).toBe(false);
    }
  });
});
