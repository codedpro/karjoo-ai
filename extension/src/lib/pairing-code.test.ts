/**
 * Pairing-code helper tests (pure logic).
 */
import { describe, it, expect } from "vitest";
import { normalizePairingCode, isValidPairingCodeShape } from "@ext/lib/pairing-code";

describe("normalizePairingCode", () => {
  it("strips surrounding and internal whitespace/newlines", () => {
    expect(normalizePairingCode("  ab cd\nef  ")).toBe("abcdef");
  });
});

describe("isValidPairingCodeShape", () => {
  it("accepts a base64url code in the expected length range", () => {
    // 20 random bytes → 27 base64url chars (server's PAIRING_CODE_BYTES).
    expect(isValidPairingCodeShape("AbCdEf_-1234567890XyZqrstuv")).toBe(true);
  });
  it("accepts after normalizing pasted whitespace", () => {
    expect(isValidPairingCodeShape("AbCdEf_-1234 5678 90XyZqrstuv")).toBe(true);
  });
  it("rejects too-short input", () => {
    expect(isValidPairingCodeShape("short")).toBe(false);
  });
  it("rejects characters outside base64url", () => {
    expect(isValidPairingCodeShape("has spaces and !@#$ symbols here")).toBe(false);
    expect(isValidPairingCodeShape("plus+slash/equals=padding1234")).toBe(false);
  });
});
