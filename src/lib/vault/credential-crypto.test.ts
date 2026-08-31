/**
 * Credential-crypto tests. These assert the properties that make storing a
 * password tolerable at all: per-record key derivation, binding to (user, board),
 * and hard failure on any tampering.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

// کلیدِ اصلی تزریق می‌شود تا تست به محیطِ توسعه‌دهنده وابسته نباشد.
const KEY_32 = Buffer.alloc(32, 7).toString("base64");
vi.mock("@/lib/env", () => ({ vaultKeyRaw: () => KEY_32 }));

import {
  decryptCredential,
  encryptCredential,
  maskUsername,
  parseCredential,
  serializeCredential,
  type EncryptedCredential,
} from "@/lib/vault/credential-crypto";
import { VaultDecryptionError } from "@/lib/vault/crypto";

const SCOPE = { userId: "11111111-1111-4111-8111-111111111111", board: "jobinja" };
const OTHER_USER = { userId: "22222222-2222-4222-8222-222222222222", board: "jobinja" };
const OTHER_BOARD = { userId: SCOPE.userId, board: "irantalent" };
const SECRET = serializeCredential({ username: "user@example.com", password: "hunter2-correct-horse" });

describe("encrypt/decrypt round trip", () => {
  it("returns exactly what was encrypted", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(parseCredential(decryptCredential(record, SCOPE))).toEqual({
      username: "user@example.com",
      password: "hunter2-correct-horse",
    });
  });

  it("never stores the password in the clear", () => {
    const record = encryptCredential(SECRET, SCOPE);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("user@example.com");
  });
});

describe("per-record key derivation", () => {
  it("gives every record its own salt and ciphertext, even for identical input", () => {
    const a = encryptCredential(SECRET, SCOPE);
    const b = encryptCredential(SECRET, SCOPE);
    expect(a.salt).not.toEqual(b.salt);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("uses a 32-byte salt and a 12-byte iv", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(Buffer.from(record.salt, "base64")).toHaveLength(32);
    expect(Buffer.from(record.iv, "base64")).toHaveLength(12);
  });
});

describe("binding to (user, board)", () => {
  it("refuses to decrypt another user's row — a stolen row cannot be replayed", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(() => decryptCredential(record, OTHER_USER)).toThrow(VaultDecryptionError);
  });

  it("refuses to decrypt the same user's row under a different board", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(() => decryptCredential(record, OTHER_BOARD)).toThrow(VaultDecryptionError);
  });
});

describe("tamper detection", () => {
  const mutate = (record: EncryptedCredential, field: keyof EncryptedCredential) => {
    const bytes = Buffer.from(String(record[field]), "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    return { ...record, [field]: bytes.toString("base64") };
  };

  it("rejects a flipped bit in the ciphertext, the iv, or the salt", () => {
    const record = encryptCredential(SECRET, SCOPE);
    for (const field of ["ciphertext", "iv", "salt"] as const) {
      expect(() => decryptCredential(mutate(record, field), SCOPE), field).toThrow(
        VaultDecryptionError,
      );
    }
  });

  it("rejects an unknown key version rather than guessing", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(() => decryptCredential({ ...record, keyVersion: 99 }, SCOPE)).toThrow(
      VaultDecryptionError,
    );
  });

  it("rejects a truncated ciphertext", () => {
    const record = encryptCredential(SECRET, SCOPE);
    expect(() => decryptCredential({ ...record, ciphertext: "AAAA" }, SCOPE)).toThrow(
      VaultDecryptionError,
    );
  });
});

describe("parseCredential", () => {
  it("rejects a stored blob that is not a credential", () => {
    expect(() => parseCredential(JSON.stringify({ u: 1, p: 2 }))).toThrow(VaultDecryptionError);
  });
});

describe("maskUsername", () => {
  it("shows enough to recognize the account and nothing more", () => {
    expect(maskUsername("amirhossein@gmail.com")).toBe("am•••••••••@gmail.com");
    expect(maskUsername("ab@x.ir")).toBe("ab••@x.ir");
    expect(maskUsername("09121234567")).toBe("09•••••••••");
  });
});
