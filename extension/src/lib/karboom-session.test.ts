import { describe, expect, it, vi } from "vitest";
import {
  karboomAccountLabel,
  karboomLoggedInFromResponse,
  probeKarboomIdentity,
} from "@ext/lib/karboom-session";

const PROFILE_HTML = '<div class="js-user-name">علی رضایی</div>';

function reply(status: number, body = "", location?: string): Response {
  return new Response(status >= 300 && status < 400 ? null : body, {
    status,
    ...(location ? { headers: { location } } : {}),
  });
}

describe("karboomLoggedInFromResponse", () => {
  it("۲۰۰ روی /profile یعنی وارد شده", () => {
    expect(karboomLoggedInFromResponse(200, null)).toBe(true);
  });

  it("۳۰۲ به /account یعنی وارد نشده", () => {
    // مهمان‌ها این‌جا می‌افتند؛ اگر ریدایرکت را دنبال می‌کردیم ۲۰۰ می‌دیدیم و
    // اشتباهاً «وارد شده» می‌خواندیم.
    expect(karboomLoggedInFromResponse(302, "https://karboom.io/account?_back=x")).toBe(false);
    expect(karboomLoggedInFromResponse(302, "https://karboom.io/auth/signin")).toBe(false);
  });

  it("ریدایرکتِ بی‌ربط را خروج حساب نمی‌کند", () => {
    expect(karboomLoggedInFromResponse(302, "https://karboom.io/profile/")).toBe(true);
  });

  it("خطای سرور را ورود نمی‌خواند", () => {
    expect(karboomLoggedInFromResponse(500, null)).toBe(false);
  });
});

describe("karboomAccountLabel", () => {
  it("نامِ نمایشیِ غیرمحرمانه را برمی‌دارد", () => {
    expect(karboomAccountLabel(PROFILE_HTML)).toBe("علی رضایی");
  });

  it("وقتی نامی نیست چیزی از خود درنمی‌آورد", () => {
    expect(karboomAccountLabel("<div></div>")).toBeUndefined();
  });
});

describe("probeKarboomIdentity", () => {
  it("نشستِ واقعی را با نامِ حساب تأیید می‌کند", async () => {
    const fetchImpl = vi.fn(async () => reply(200, PROFILE_HTML)) as unknown as typeof fetch;
    await expect(probeKarboomIdentity(fetchImpl)).resolves.toEqual({
      loggedIn: true,
      accountLabelHint: "علی رضایی",
    });
  });

  it("ریدایرکت را دنبال نمی‌کند تا مهمان با کاربر اشتباه نشود", async () => {
    const fetchImpl = vi.fn(async () => reply(302, "", "https://karboom.io/account?_back=x")) as unknown as typeof fetch;
    await expect(probeKarboomIdentity(fetchImpl)).resolves.toEqual({
      loggedIn: false, reason: "logged_out",
    });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({ redirect: "manual" });
  });

  it("۴۲۹ را چالشِ امنیتی می‌خواند، نه خروج", async () => {
    const fetchImpl = vi.fn(async () => reply(429)) as unknown as typeof fetch;
    await expect(probeKarboomIdentity(fetchImpl)).resolves.toEqual({
      loggedIn: false, reason: "security_challenge",
    });
  });

  it("خطای شبکه را «ورود» تعبیر نمی‌کند", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    await expect(probeKarboomIdentity(fetchImpl)).resolves.toEqual({
      loggedIn: false, reason: "probe_unavailable",
    });
  });
});
