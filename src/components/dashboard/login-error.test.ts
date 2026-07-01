/**
 * تست‌های نگاشتِ خطای ورود (`login-error.ts`) — تابعِ محض، بدونِ I/O.
 *
 * تمرکز:
 *   • نبودِ خطا (undefined/تهی) → null (بنر رندر نشود).
 *   • کدهای شناخته‌شده (state/oauth/oauth_unconfigured) → پیامِ عمومیِ فارسی.
 *   • کدِ ناشناخته → پیامِ عمومی (هرگز کدِ خام).
 *   • آرایه (تکراریِ Next) → اولین مقدار خوانده می‌شود.
 */
import { describe, expect, it } from "vitest";

import {
  GENERIC_LOGIN_ERROR,
  loginErrorMessage,
} from "./login-error";

describe("loginErrorMessage", () => {
  it("نبودِ خطا → null", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage("")).toBeNull();
    expect(loginErrorMessage([])).toBeNull();
  });

  it("کدهای شناخته‌شده‌ی جریانِ OAuth → پیامِ عمومیِ فارسی", () => {
    for (const code of ["state", "oauth", "oauth_unconfigured"]) {
      expect(loginErrorMessage(code)).toBe(GENERIC_LOGIN_ERROR);
    }
  });

  it("لغوِ دسترسی (access_denied) پیامِ اختصاصیِ خود را دارد", () => {
    const msg = loginErrorMessage("access_denied");
    expect(msg).not.toBeNull();
    expect(msg).not.toBe(GENERIC_LOGIN_ERROR);
    expect(msg).toContain("گوگل");
  });

  it("کدِ ناشناخته → پیامِ عمومی (نه کدِ خام)", () => {
    const msg = loginErrorMessage("some_unexpected_code");
    expect(msg).toBe(GENERIC_LOGIN_ERROR);
    expect(msg).not.toContain("some_unexpected_code");
  });

  it("آرایه‌ی مقادیر → اولین عضو نگاشت می‌شود", () => {
    expect(loginErrorMessage(["state", "oauth"])).toBe(GENERIC_LOGIN_ERROR);
    expect(loginErrorMessage(["access_denied"])).toBe(
      loginErrorMessage("access_denied"),
    );
  });

  it("هیچ پیامی کدِ خام را به کاربر لو نمی‌دهد", () => {
    // پیامِ عمومی نباید شبیهِ اسنیپِت/کدِ فنی باشد.
    expect(GENERIC_LOGIN_ERROR).not.toMatch(/[a-z_]{3,}/);
  });
});
