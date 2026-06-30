/**
 * تست‌های رمزنگاریِ خزانه (crypto.ts) — round-trip، tamper (auth-tag)، و
 * fail-closed وقتی کلید تنظیم نشده/نامعتبر است.
 *
 * `@/lib/env` mock می‌شود تا کلیدِ خزانه را به‌صورتِ کنترل‌شده تزریق کنیم (بدونِ وابستگی
 * به محیطِ توسعه‌دهنده). یک کلیدِ ۳۲ بایتیِ ثابت (base64) به‌عنوان پیش‌فرض ست می‌شود.
 */
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

// کلیدِ ۳۲ بایتیِ تستی (base64) — مقدارش بی‌اهمیت است، فقط طولش باید ۳۲ بایت باشد.
const KEY_32 = Buffer.alloc(32, 7).toString("base64");

const vaultKeyMock = vi.fn<() => string | null>(() => KEY_32);

vi.mock("@/lib/env", () => ({
  vaultKeyRaw: () => vaultKeyMock(),
}));

import {
  CURRENT_KEY_VERSION,
  decryptSession,
  encryptSession,
  isVaultReady,
  requireVaultKey,
  VaultDecryptionError,
  VaultNotConfiguredError,
} from "@/lib/vault/crypto";

afterEach(() => {
  vaultKeyMock.mockReturnValue(KEY_32);
});

describe("encryptSession / decryptSession — round-trip", () => {
  it("plaintext پس از رمز/رمزگشایی دست‌نخورده برمی‌گردد", () => {
    const plain = JSON.stringify({ cookies: [{ name: "auth", value: "secret" }] });
    const blob = encryptSession(plain);

    expect(blob.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(typeof blob.ciphertext).toBe("string");
    expect(typeof blob.iv).toBe("string");
    // ciphertext نباید plaintext را آشکار کند.
    expect(blob.ciphertext).not.toContain("secret");

    const back = decryptSession(blob);
    expect(back).toBe(plain);
  });

  it("هر رمزنگاری IV تصادفیِ متفاوت می‌سازد (nonce تکراری نیست)", () => {
    const a = encryptSession("same");
    const b = encryptSession("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSession(a)).toBe("same");
    expect(decryptSession(b)).toBe("same");
  });

  it("یونیکدِ فارسی به‌درستی round-trip می‌شود", () => {
    const plain = "نشستِ کاربر — توکنِ احراز ۱۲۳";
    expect(decryptSession(encryptSession(plain))).toBe(plain);
  });
});

describe("decryptSession — tamper ⇒ auth-tag failure", () => {
  it("دستکاریِ ciphertext ⇒ VaultDecryptionError", () => {
    const blob = encryptSession("payload");
    // یک بایت از ciphertext را تغییر می‌دهیم.
    const buf = Buffer.from(blob.ciphertext, "base64");
    buf[0] = buf[0] ^ 0xff;
    const tampered = { ...blob, ciphertext: buf.toString("base64") };

    expect(() => decryptSession(tampered)).toThrow(VaultDecryptionError);
  });

  it("دستکاریِ IV ⇒ VaultDecryptionError", () => {
    const blob = encryptSession("payload");
    const iv = Buffer.from(blob.iv, "base64");
    iv[0] = iv[0] ^ 0xff;
    expect(() => decryptSession({ ...blob, iv: iv.toString("base64") })).toThrow(
      VaultDecryptionError,
    );
  });

  it("کلیدِ متفاوت ⇒ VaultDecryptionError", () => {
    const blob = encryptSession("payload");
    // کلیدِ دیگری ست می‌کنیم؛ رمزگشایی باید شکست بخورد.
    vaultKeyMock.mockReturnValue(Buffer.alloc(32, 9).toString("base64"));
    expect(() => decryptSession(blob)).toThrow(VaultDecryptionError);
  });

  it("نسخه‌ی کلیدِ ناهم‌خوان ⇒ VaultDecryptionError", () => {
    const blob = encryptSession("payload");
    expect(() => decryptSession({ ...blob, keyVersion: 999 })).toThrow(
      VaultDecryptionError,
    );
  });
});

describe("fail-closed وقتی کلید تنظیم/معتبر نیست", () => {
  it("کلیدِ غایب ⇒ VaultNotConfiguredError (encrypt)", () => {
    vaultKeyMock.mockReturnValue(null);
    expect(() => encryptSession("x")).toThrow(VaultNotConfiguredError);
    expect(isVaultReady()).toBe(false);
  });

  it("کلیدِ با طولِ نادرست ⇒ VaultNotConfiguredError", () => {
    vaultKeyMock.mockReturnValue(Buffer.alloc(16, 1).toString("base64")); // فقط ۱۶ بایت
    expect(() => requireVaultKey()).toThrow(VaultNotConfiguredError);
    expect(isVaultReady()).toBe(false);
  });

  it("کلیدِ معتبرِ ۳۲ بایتی ⇒ isVaultReady=true و requireVaultKey ۳۲ بایت می‌دهد", () => {
    vaultKeyMock.mockReturnValue(KEY_32);
    expect(isVaultReady()).toBe(true);
    expect(requireVaultKey().length).toBe(32);
  });

  it("کلیدِ hexِ ۶۴ کاراکتری هم پذیرفته می‌شود (۳۲ بایت)", () => {
    const hex = Buffer.alloc(32, 3).toString("hex");
    vaultKeyMock.mockReturnValue(hex);
    expect(isVaultReady()).toBe(true);
    const plain = "hex-key payload";
    expect(decryptSession(encryptSession(plain))).toBe(plain);
  });
});
