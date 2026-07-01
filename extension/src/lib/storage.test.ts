/**
 * Storage helper tests — exercised against an in-memory StorageArea fake, so no
 * real chrome.storage / browser is needed. Covers the pairing-token lifecycle
 * and API-origin normalization.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { STORAGE_KEYS, DEFAULT_API_ORIGIN } from "@ext/lib/config";
import {
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  isPaired,
  getApiOrigin,
  normalizeOrigin,
  getIdentity,
  setIdentity,
  type StorageArea,
} from "@ext/lib/storage";

/** Minimal in-memory StorageArea matching the promise-based slice we use. */
function makeFakeArea(): StorageArea & { _data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    _data: data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

describe("session token storage (pairing lifecycle)", () => {
  let area: ReturnType<typeof makeFakeArea>;
  beforeEach(() => {
    area = makeFakeArea();
  });

  it("starts unpaired", async () => {
    expect(await isPaired(area)).toBe(false);
    expect(await getSessionToken(area)).toBeNull();
  });

  it("stores and reads back a token", async () => {
    await setSessionToken("karjoo-ext-token-abc", area);
    expect(await getSessionToken(area)).toBe("karjoo-ext-token-abc");
    expect(await isPaired(area)).toBe(true);
    expect(area._data[STORAGE_KEYS.sessionToken]).toBe("karjoo-ext-token-abc");
  });

  it("refuses to store an empty token", async () => {
    await expect(setSessionToken("", area)).rejects.toThrow();
  });

  it("clearSessionToken removes both token and identity", async () => {
    await setSessionToken("t", area);
    await setIdentity({ userId: "u1" }, area);
    await clearSessionToken(area);
    expect(await getSessionToken(area)).toBeNull();
    expect(await getIdentity(area)).toBeNull();
    expect(await isPaired(area)).toBe(false);
  });

  it("round-trips identity", async () => {
    await setIdentity({ userId: "u1", displayName: "علی" }, area);
    expect(await getIdentity(area)).toEqual({ userId: "u1", displayName: "علی" });
  });
});

describe("API origin (LOCKED — not user-overridable)", () => {
  let area: ReturnType<typeof makeFakeArea>;
  beforeEach(() => {
    area = makeFakeArea();
  });

  it("always returns the compile-time default", async () => {
    expect(await getApiOrigin(area)).toBe(DEFAULT_API_ORIGIN);
  });

  it("defaults to the production control-plane origin", () => {
    // Locked to prod so a user can never repoint the extension at a rogue plane.
    expect(DEFAULT_API_ORIGIN).toBe("https://karjooai.itmaster.uk");
  });

  it("ignores any origin value present in storage (cannot be overridden)", async () => {
    // Even if a value somehow lands under the old key, getApiOrigin never reads it.
    await area.set({ "karjoo.apiOrigin": "https://evil.example/" });
    expect(await getApiOrigin(area)).toBe(DEFAULT_API_ORIGIN);
  });

  it("returns the default with no area passed", async () => {
    expect(await getApiOrigin()).toBe(DEFAULT_API_ORIGIN);
  });

  it("normalizeOrigin rejects non-http(s) protocols", () => {
    expect(() => normalizeOrigin("ftp://x.test")).toThrow();
    expect(() => normalizeOrigin("not a url")).toThrow();
  });
});
