/**
 * update-check tests — the resilient "is a newer extension available?" probe
 * (BUG 5). The core requirement is that it NEVER throws and NEVER fakes an
 * update: any network/timeout/parse failure resolves to updateAvailable=false,
 * and a hostile/garbled version string can't trip the banner.
 */
import { describe, it, expect } from "vitest";
import {
  checkForUpdate,
  decideUpdate,
  parseVersionManifest,
  type FetchLike,
  type VersionManifest,
} from "@ext/lib/update-check";

const ORIGIN = "https://karjooai.itmaster.uk";

/** A fetch fake that returns a given JSON body with a chosen ok flag. */
function fakeFetch(body: unknown, ok = true): FetchLike {
  return async () => ({ ok, json: async () => body });
}

describe("parseVersionManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(
      parseVersionManifest({ version: "0.3.0", downloadUrl: "/karjoo-extension.zip", notes: "بهبودها" }),
    ).toEqual({ version: "0.3.0", downloadUrl: "/karjoo-extension.zip", notes: "بهبودها" });
  });

  it("keeps just the version when optional fields are absent", () => {
    expect(parseVersionManifest({ version: "0.3.0" })).toEqual({ version: "0.3.0" });
  });

  it("rejects bodies without a usable version string (fail-closed)", () => {
    expect(parseVersionManifest(null)).toBeNull();
    expect(parseVersionManifest("nope")).toBeNull();
    expect(parseVersionManifest({})).toBeNull();
    expect(parseVersionManifest({ version: "" })).toBeNull();
    expect(parseVersionManifest({ version: 5 })).toBeNull();
  });
});

describe("decideUpdate (pure)", () => {
  it("reports an update and absolutizes a relative downloadUrl", () => {
    const m: VersionManifest = { version: "0.3.0", downloadUrl: "/karjoo-extension.zip" };
    const r = decideUpdate("0.2.0", m, ORIGIN);
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe("0.3.0");
    expect(r.downloadUrl).toBe(`${ORIGIN}/karjoo-extension.zip`);
  });

  it("falls back to the canonical zip path when downloadUrl is omitted", () => {
    const r = decideUpdate("0.2.0", { version: "0.3.0" }, ORIGIN);
    expect(r.updateAvailable).toBe(true);
    expect(r.downloadUrl).toBe(`${ORIGIN}/karjoo-extension.zip`);
  });

  it("carries notes through when present", () => {
    const r = decideUpdate("0.2.0", { version: "0.3.0", notes: "رفع اشکال" }, ORIGIN);
    expect(r.notes).toBe("رفع اشکال");
  });

  it("no update when server is equal or older", () => {
    expect(decideUpdate("0.2.0", { version: "0.2.0" }, ORIGIN).updateAvailable).toBe(false);
    expect(decideUpdate("0.2.0", { version: "0.1.0" }, ORIGIN).updateAvailable).toBe(false);
  });

  it("no update on a null manifest", () => {
    expect(decideUpdate("0.2.0", null, ORIGIN).updateAvailable).toBe(false);
  });

  it("does not fake an update from a malformed version", () => {
    expect(decideUpdate("0.2.0", { version: "9.9.9-hacked" }, ORIGIN).updateAvailable).toBe(false);
  });
});

describe("checkForUpdate (integration, injectable fetch)", () => {
  it("returns updateAvailable when the server is newer", async () => {
    const r = await checkForUpdate(ORIGIN, "0.2.0", {
      fetchImpl: fakeFetch({ version: "0.3.0", downloadUrl: "/karjoo-extension.zip" }),
    });
    expect(r).toMatchObject({ updateAvailable: true, latestVersion: "0.3.0" });
    expect(r.downloadUrl).toBe(`${ORIGIN}/karjoo-extension.zip`);
  });

  it("returns no update when versions match", async () => {
    const r = await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: fakeFetch({ version: "0.2.0" }) });
    expect(r.updateAvailable).toBe(false);
  });

  it("resolves to no-update on a non-2xx response (never throws)", async () => {
    const r = await checkForUpdate(ORIGIN, "0.2.0", {
      fetchImpl: fakeFetch({ version: "9.9.9" }, false),
    });
    expect(r.updateAvailable).toBe(false);
  });

  it("resolves to no-update when fetch rejects (network failure)", async () => {
    const throwing: FetchLike = async () => {
      throw new Error("network down");
    };
    const r = await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: throwing });
    expect(r.updateAvailable).toBe(false);
  });

  it("resolves to no-update when json parsing throws (bad body)", async () => {
    const badJson: FetchLike = async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    const r = await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: badJson });
    expect(r.updateAvailable).toBe(false);
  });

  it("resolves to no-update when no fetch implementation is available", async () => {
    // Simulate an environment with NO fetch at all: inject undefined AND remove the
    // global. (Just passing fetchImpl:undefined falls back to globalThis.fetch, which
    // exists in Node — so we must unset it to exercise the `!fetchImpl` guard.)
    const savedFetch = globalThis.fetch;
    // @ts-expect-error — intentionally removing fetch to simulate its absence
    delete globalThis.fetch;
    try {
      const r = await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: undefined });
      expect(r.updateAvailable).toBe(false);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("hits the /api/extension/version endpoint on the given origin", async () => {
    let calledUrl = "";
    const spy: FetchLike = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ version: "0.2.0" }) };
    };
    await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: spy });
    expect(calledUrl).toBe(`${ORIGIN}/api/extension/version`);
  });

  it("times out and resolves to no-update if the server hangs", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        // Reject when the AbortController fires (mirrors real fetch abort).
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const r = await checkForUpdate(ORIGIN, "0.2.0", { fetchImpl: hanging, timeoutMs: 20 });
    expect(r.updateAvailable).toBe(false);
  });
});
