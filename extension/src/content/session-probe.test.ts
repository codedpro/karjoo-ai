/**
 * session-probe — the pure storage reader. Proves it copies every key→value pair
 * out of a Storage-like object (so the apply flow can replay the user's own SPA
 * token). Uses an in-memory fake Storage; no real browser.
 */
import { describe, it, expect } from "vitest";
import { readStorage, captureStorage } from "@ext/content/session-probe";

/** Minimal in-memory Storage shim matching the Web Storage interface we use. */
function fakeStorage(init: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(init));
  return {
    get length() {
      return data.size;
    },
    key(i: number) {
      return Array.from(data.keys())[i] ?? null;
    },
    getItem(k: string) {
      return data.has(k) ? data.get(k)! : null;
    },
    setItem(k: string, v: string) {
      data.set(k, v);
    },
    removeItem(k: string) {
      data.delete(k);
    },
    clear() {
      data.clear();
    },
  } as Storage;
}

describe("readStorage", () => {
  it("reads all key→value pairs", () => {
    const s = fakeStorage({ access_token: "jwt", theme: "dark" });
    expect(readStorage(s)).toEqual({ access_token: "jwt", theme: "dark" });
  });
  it("returns empty for empty storage", () => {
    expect(readStorage(fakeStorage())).toEqual({});
  });
});

describe("captureStorage", () => {
  it("captures both local + session storage", () => {
    const win = {
      localStorage: fakeStorage({ access_token: "L" }),
      sessionStorage: fakeStorage({ tmp: "S" }),
    };
    expect(captureStorage(win)).toEqual({
      localStorage: { access_token: "L" },
      sessionStorage: { tmp: "S" },
    });
  });
});
