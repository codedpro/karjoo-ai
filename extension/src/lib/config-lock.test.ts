/**
 * config-lock — proves the control-plane origin is HARD-LOCKED to the production
 * plane and cannot be a localhost/dev origin in a shipped build, and that
 * getApiOrigin() is pinned to that compile-time constant (never storage-backed).
 *
 * These are the safety invariants for BUG 2: no way for a user to repoint the
 * extension at a rogue control plane.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_API_ORIGIN, STORAGE_KEYS } from "@ext/lib/config";
import { getApiOrigin, type StorageArea } from "@ext/lib/storage";

describe("locked control-plane origin", () => {
  it("is the production HTTPS control plane", () => {
    expect(DEFAULT_API_ORIGIN).toBe("https://karjoo.1xai.ir");
  });

  it("is https (never plaintext) and has no trailing slash", () => {
    expect(DEFAULT_API_ORIGIN.startsWith("https://")).toBe(true);
    expect(DEFAULT_API_ORIGIN.endsWith("/")).toBe(false);
  });

  it("is never a localhost / loopback origin", () => {
    expect(DEFAULT_API_ORIGIN).not.toMatch(/localhost|127\.0\.0\.1|0\.0\.0\.0/i);
  });

  it("exposes no apiOrigin storage key (nothing to override)", () => {
    expect((STORAGE_KEYS as Record<string, string>).apiOrigin).toBeUndefined();
  });
});

describe("getApiOrigin is pinned to the constant", () => {
  /** An area whose reads would win IF getApiOrigin ever consulted storage. */
  function trapArea(): StorageArea {
    return {
      async get() {
        return { "karjoo.apiOrigin": "https://attacker.example" };
      },
      async set() {
        throw new Error("getApiOrigin must not write storage");
      },
      async remove() {
        throw new Error("getApiOrigin must not write storage");
      },
    };
  }

  it("returns the constant even when storage would return something else", async () => {
    expect(await getApiOrigin(trapArea())).toBe(DEFAULT_API_ORIGIN);
  });
});
