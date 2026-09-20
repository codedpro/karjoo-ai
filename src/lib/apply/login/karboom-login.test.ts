/**
 * Karboom server-side login tests.
 *
 * The behaviour that matters most is the one that is NOT about logging in:
 * Karboom answers an unknown email with a SIGNUP form on the very same URL the
 * login form uses. Posting to it blindly would create an account the user never
 * asked for, under a password Karjoo chose to send. That must be impossible.
 *
 * The rest is the usual contract: never report ok without proving the session
 * opens a private page, and map each refusal to a reason the user can act on.
 */
import { describe, expect, it, vi } from "vitest";

import {
  accountLabelFrom,
  classifyAccountPage,
  csrfTokenFrom,
  karboomLoginDriver,
  looksLikeChallenge,
  looksLikeRegistration,
} from "@/lib/apply/login/karboom-login";

const CRED = { username: "user@example.com", password: "hunter2" };
const EMAIL_PAGE = `<html><body><form action="" method="POST">
  <input type="hidden" name="_token" value="TOKEN-1">
  <input type="email" name="email" required></form></body></html>`;
const LOGIN_PASSWORD_PAGE = `<html><body><form method="POST">
  <input type="hidden" name="_token" value="TOKEN-2">
  <input type="password" name="password"></form></body></html>`;
/** What Karboom really returns for an unregistered email (verified live). */
const SIGNUP_PASSWORD_PAGE = `<html><body><form method="POST">
  <input type="hidden" name="_token" value="TOKEN-2">
  <input type="password" name="password">
  <input type="password" name="password_confirmation"></form></body></html>`;
const PROFILE_PAGE = `<html><body><input name="full_name" value="Ali Karimi"></body></html>`;

interface StubOptions {
  passwordPage?: string;
  /** Status of the POST that submits the password (302 = accepted). */
  submitStatus?: number;
  submitBody?: string;
  emailStepStatus?: number;
  emailStepBody?: string;
  emailStepLocation?: string | null;
  setCookie?: string;
}

function stub(options: StubOptions = {}) {
  const calls: { url: string; method: string; body: string }[] = [];

  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? String(init.body) : "";
    calls.push({ url: href, method, body });

    const html = (text: string, status = 200, headers: Record<string, string> = {}) =>
      new Response(text, {
        status,
        headers: {
          "content-type": "text/html",
          "set-cookie": options.setCookie ?? "karboom_session=SID; Path=/; HttpOnly",
          ...headers,
        },
      });

    if (href.endsWith("/account") && method === "GET") return html(EMAIL_PAGE);

    if (href.endsWith("/account") && method === "POST") {
      const status = options.emailStepStatus ?? 302;
      if (status === 200) return html(options.emailStepBody ?? EMAIL_PAGE, 200);
      const location =
        options.emailStepLocation === undefined
          ? "https://karboom.io/account/password?_t=SIGNED"
          : options.emailStepLocation;
      return html("", status, ...(location ? [{ location }] : [{}]));
    }

    if (href.includes("/account/password") && method === "GET") {
      return html(options.passwordPage ?? LOGIN_PASSWORD_PAGE);
    }
    if (href.includes("/account/password") && method === "POST") {
      const status = options.submitStatus ?? 302;
      return status === 200
        ? html(options.submitBody ?? LOGIN_PASSWORD_PAGE, 200)
        : html("", status, { location: "https://karboom.io/profile" });
    }

    if (href.endsWith("/profile")) {
      // `Response.url` is read-only here; withFinalUrl() sets the landing URL.
      return new Response(PROFILE_PAGE, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return html("not found", 404);
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** Response.url is not settable via the constructor; patch it for verify checks. */
function withFinalUrl(fetchImpl: typeof fetch, finalUrl: string): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const res = await (fetchImpl as (u: string | URL, i?: RequestInit) => Promise<Response>)(url, init);
    if (String(url).endsWith("/profile")) Object.defineProperty(res, "url", { value: finalUrl });
    return res;
  }) as unknown as typeof fetch;
}

describe("pure helpers", () => {
  it("reads the CSRF token from an input or a meta tag", () => {
    expect(csrfTokenFrom(EMAIL_PAGE)).toBe("TOKEN-1");
    expect(csrfTokenFrom(`<meta name="csrf-token" content="M">`)).toBe("M");
    expect(csrfTokenFrom("<html></html>")).toBeNull();
  });

  it("recognises the signup form by its confirmation field", () => {
    expect(looksLikeRegistration(SIGNUP_PASSWORD_PAGE)).toBe(true);
    expect(looksLikeRegistration(LOGIN_PASSWORD_PAGE)).toBe(false);
  });

  it("treats mosparo and the usual captchas as a challenge", () => {
    expect(looksLikeChallenge("<div class=mosparo></div>")).toBe(true);
    expect(looksLikeChallenge("<div class=g-recaptcha></div>")).toBe(true);
    expect(looksLikeChallenge(LOGIN_PASSWORD_PAGE)).toBe(false);
  });

  it("maps the board's own wording to an actionable reason", () => {
    expect(classifyAccountPage("رمز ورود اشتباه است")).toMatchObject({
      reason: "invalid_credentials",
    });
    expect(classifyAccountPage("تعداد تلاش بیش از حد")).toMatchObject({ reason: "rate_limited" });
    expect(classifyAccountPage("لطفا تأیید ایمیل را انجام دهید")).toMatchObject({
      reason: "account_action_required",
    });
    expect(classifyAccountPage(LOGIN_PASSWORD_PAGE)).toBeNull();
  });

  it("picks a non-secret display label off the profile", () => {
    expect(accountLabelFrom(PROFILE_PAGE)).toBe("Ali Karimi");
    expect(accountLabelFrom("<html></html>")).toBeNull();
  });
});

describe("karboomLoginDriver — never creates an account", () => {
  it("refuses an unregistered email instead of submitting the signup form", async () => {
    const { fetchImpl, calls } = stub({ passwordPage: SIGNUP_PASSWORD_PAGE });
    const result = await karboomLoginDriver.login(CRED, fetchImpl);

    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
    // The decisive assertion: nothing was ever POSTed to the password step.
    const posted = calls.filter((c) => c.url.includes("/account/password") && c.method === "POST");
    expect(posted).toHaveLength(0);
  });

  it("never sends password_confirmation on the real login path", async () => {
    const { fetchImpl, calls } = stub();
    await karboomLoginDriver.login(CRED, withFinalUrl(fetchImpl, "https://karboom.io/profile"));
    const posted = calls.find((c) => c.url.includes("/account/password") && c.method === "POST");
    expect(posted).toBeDefined();
    expect(posted!.body).not.toContain("password_confirmation");
    expect(new URLSearchParams(posted!.body).get("password")).toBe("hunter2");
  });
});

describe("karboomLoginDriver — the happy path", () => {
  it("returns a cookie session only after a private page opens", async () => {
    const { fetchImpl, calls } = stub();
    const result = await karboomLoginDriver.login(
      CRED,
      withFinalUrl(fetchImpl, "https://karboom.io/profile"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionShape).toBe("cookie");
    expect(JSON.parse(result.session).cookies[0].name).toBe("karboom_session");
    expect(result.accountLabel).toBe("Ali Karimi");
    // Both steps ran, in order, and the profile was actually fetched.
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /account",
      "POST /account",
      "GET /account/password",
      "POST /account/password",
      "GET /profile",
    ]);
  });

  it("carries the password step's own fresh token, not the email step's", async () => {
    const { fetchImpl, calls } = stub();
    await karboomLoginDriver.login(CRED, withFinalUrl(fetchImpl, "https://karboom.io/profile"));
    const posted = calls.find((c) => c.url.includes("/account/password") && c.method === "POST")!;
    expect(new URLSearchParams(posted.body).get("_token")).toBe("TOKEN-2");
  });

  it("never reports ok when the private page bounces back to /account", async () => {
    const { fetchImpl } = stub();
    const result = await karboomLoginDriver.login(
      CRED,
      withFinalUrl(fetchImpl, "https://karboom.io/account"),
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });
});

describe("karboomLoginDriver — refusals", () => {
  it("stops on a challenge rather than trying to get around it", async () => {
    const { fetchImpl } = stub({ passwordPage: `<div class="mosparo"></div>` });
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "security_challenge",
    });
  });

  it("reports rate limiting distinctly", async () => {
    const { fetchImpl } = stub({ submitStatus: 429 });
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("does not mistake a board outage for a bad password", async () => {
    const { fetchImpl } = stub({ submitStatus: 503 });
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  it("tells the user when the account needs Google/LinkedIn instead", async () => {
    const { fetchImpl } = stub({ emailStepLocation: "https://accounts.google.com/o/oauth2/auth" });
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "account_action_required",
    });
  });

  it("flags a changed provider when the redirect disappears", async () => {
    const { fetchImpl } = stub({ emailStepLocation: null });
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "provider_changed",
    });
  });

  it("turns a network error into a reason instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await karboomLoginDriver.login(CRED, fetchImpl)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });
});
