/**
 * تست‌های واحدِ ارسالِ پیامکِ OTP — بدون شبکه (fetch/config/logger تزریق‌شده).
 *
 * موردِ کلیدی (CONTEXT ۶): بدونِ هیچ providerی، کد در کنسول لاگ می‌شود و نتیجه‌ی
 * typed `dev_mode` برمی‌گردد — هرگز throw نمی‌شود.
 */
import { describe, expect, it, vi } from "vitest";

import { sendOtpSms, toLocalIranPhone } from "@/lib/auth/sms";

describe("sendOtpSms — حالتِ توسعه (بدون provider)", () => {
  it("کد را لاگ می‌کند و نتیجه‌ی dev_mode می‌دهد", async () => {
    const logs: string[] = [];
    const res = await sendOtpSms("+989121234567", "123456", {
      config: null,
      logger: (m) => logs.push(m),
    });
    expect(res).toEqual({ ok: true, mode: "dev_mode" });
    expect(logs.join("\n")).toContain("123456");
  });

  it("هرگز throw نمی‌کند حتی اگر هیچ‌چیز تنظیم نشده باشد", async () => {
    await expect(
      sendOtpSms("0912", "0000", { config: null, logger: () => {} }),
    ).resolves.toMatchObject({ ok: true, mode: "dev_mode" });
  });
});

describe("sendOtpSms — Kavenegar", () => {
  it("با template از verify/lookup استفاده می‌کند و sent برمی‌گرداند", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    const res = await sendOtpSms("+989121234567", "654321", {
      config: { provider: "kavenegar", apiKey: "KEY", template: "karjoo-otp" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ ok: true, mode: "sent", provider: "kavenegar" });
    const url = (fetchImpl.mock.calls[0]![0] as string);
    expect(url).toContain("/verify/lookup.json");
    expect(url).toContain("token=654321");
    expect(url).toContain("template=karjoo-otp");
    // شماره به قالبِ محلیِ ایران نرمال شده.
    expect(url).toContain("receptor=09121234567");
  });

  it("بدون template از sms/send استفاده می‌کند", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    await sendOtpSms("09121234567", "111111", {
      config: { provider: "kavenegar", apiKey: "KEY" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect((fetchImpl.mock.calls[0]![0] as string)).toContain("/sms/send.json");
  });

  it("پاسخِ غیر-200 → نتیجه‌ی error (بدونِ throw)", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("nope", { status: 500 }),
    );
    const res = await sendOtpSms("09121234567", "1", {
      config: { provider: "kavenegar", apiKey: "K", template: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, mode: "error", provider: "kavenegar" });
  });
});

describe("toLocalIranPhone", () => {
  it("قالب‌های مختلف را به 09xxxxxxxxx نرمال می‌کند", () => {
    expect(toLocalIranPhone("+989121234567")).toBe("09121234567");
    expect(toLocalIranPhone("00989121234567")).toBe("09121234567");
    expect(toLocalIranPhone("9121234567")).toBe("09121234567");
    expect(toLocalIranPhone("09121234567")).toBe("09121234567");
  });
});
