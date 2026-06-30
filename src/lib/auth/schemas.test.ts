/**
 * تست‌های اسکیماهای ورودیِ احراز هویت — نرمالِ شماره به E.164 و اعتبارسنجیِ کد.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeIranPhoneE164,
  otpRequestSchema,
  otpVerifySchema,
} from "@/lib/auth/schemas";

describe("normalizeIranPhoneE164", () => {
  it("قالب‌های مختلف را به +98XXXXXXXXXX نرمال می‌کند", () => {
    expect(normalizeIranPhoneE164("09121234567")).toBe("+989121234567");
    expect(normalizeIranPhoneE164("9121234567")).toBe("+989121234567");
    expect(normalizeIranPhoneE164("+989121234567")).toBe("+989121234567");
    expect(normalizeIranPhoneE164("00989121234567")).toBe("+989121234567");
    expect(normalizeIranPhoneE164("989121234567")).toBe("+989121234567");
  });

  it("جداکننده‌ها و فاصله را نادیده می‌گیرد", () => {
    expect(normalizeIranPhoneE164("0912-123-4567")).toBe("+989121234567");
    expect(normalizeIranPhoneE164(" +98 912 123 4567 ")).toBe("+989121234567");
  });

  it("شماره‌ی نامعتبر → null", () => {
    expect(normalizeIranPhoneE164("123")).toBeNull();
    expect(normalizeIranPhoneE164("08121234567")).toBeNull(); // شروع با 8 نه 9
    expect(normalizeIranPhoneE164("091212345")).toBeNull(); // کوتاه
    expect(normalizeIranPhoneE164("")).toBeNull();
  });
});

describe("otpRequestSchema", () => {
  it("شماره را نرمال می‌کند", () => {
    const parsed = otpRequestSchema.parse({ phone: "09121234567" });
    expect(parsed.phone).toBe("+989121234567");
  });

  it("شماره‌ی نامعتبر را رد می‌کند", () => {
    expect(otpRequestSchema.safeParse({ phone: "abc" }).success).toBe(false);
    expect(otpRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("otpVerifySchema", () => {
  it("شماره و کدِ معتبر را می‌پذیرد", () => {
    const parsed = otpVerifySchema.parse({ phone: "09121234567", code: "123456" });
    expect(parsed).toEqual({ phone: "+989121234567", code: "123456" });
  });

  it("کدِ غیرعددی یا با طولِ نادرست را رد می‌کند", () => {
    expect(otpVerifySchema.safeParse({ phone: "09121234567", code: "abc" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: "09121234567", code: "12" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: "09121234567", code: "123456789" }).success).toBe(
      false,
    );
  });
});
