/**
 * Session injection tests — faithful replay of the user's OWN session (§10).
 *
 * Covers: bundle parsing (string / object / wrapped), cookie mapping (domain vs
 * url fallback, expiry), and the storage init script (origin-guarded, restores
 * localStorage + sessionStorage, null when empty).
 */
import { describe, expect, it } from "vitest";

import {
  buildStorageInitScript,
  parseSessionBundle,
  prepareSession,
} from "./session-inject.js";
import type { SessionBundle } from "./types.js";

const LISTING = "https://jobinja.ir/companies/acme/jobs/AB12cd";

describe("parseSessionBundle", () => {
  it("parses a JSON string bundle", () => {
    const bundle: SessionBundle = { cookies: [{ name: "a", value: "1" }] };
    const parsed = parseSessionBundle(JSON.stringify(bundle));
    expect(parsed.cookies?.[0]?.name).toBe("a");
  });

  it("accepts an already-parsed object", () => {
    const parsed = parseSessionBundle({ userAgent: "UA" });
    expect(parsed.userAgent).toBe("UA");
  });

  it("unwraps a { session: {...} } wrapper", () => {
    const parsed = parseSessionBundle(
      JSON.stringify({ session: { localStorage: { k: "v" } } }),
    );
    expect(parsed.localStorage?.k).toBe("v");
  });

  it("throws on a non-object", () => {
    expect(() => parseSessionBundle("\"just-a-string\"")).toThrow();
  });
});

describe("prepareSession cookies", () => {
  it("keeps domain+path cookies and copies flags/expiry", () => {
    const prepared = prepareSession(
      {
        cookies: [
          {
            name: "sess",
            value: "v",
            domain: ".jobinja.ir",
            path: "/x",
            secure: true,
            httpOnly: true,
            expirationDate: 1893456000,
          },
        ],
      },
      LISTING,
    );
    const c = prepared.cookies[0]!;
    expect(c.domain).toBe(".jobinja.ir");
    expect(c.path).toBe("/x");
    expect(c.secure).toBe(true);
    expect(c.httpOnly).toBe(true);
    expect(c.expires).toBe(1893456000);
    expect(c.url).toBeUndefined();
  });

  it("falls back to the listing URL when a cookie has no domain", () => {
    const prepared = prepareSession({ cookies: [{ name: "x", value: "y" }] }, LISTING);
    expect(prepared.cookies[0]!.url).toBe(LISTING);
    expect(prepared.cookies[0]!.domain).toBeUndefined();
  });

  it("passes the user's UA through (header parity, not spoofing)", () => {
    const prepared = prepareSession({ userAgent: "Mozilla/5.0 (X11)" }, LISTING);
    expect(prepared.userAgent).toBe("Mozilla/5.0 (X11)");
  });
});

describe("buildStorageInitScript", () => {
  it("returns null when there is no storage to restore", () => {
    expect(buildStorageInitScript({}, LISTING)).toBeNull();
    expect(buildStorageInitScript({ cookies: [{ name: "a", value: "b" }] }, LISTING)).toBeNull();
  });

  it("embeds the origin guard and both storage maps", () => {
    const script = buildStorageInitScript(
      { localStorage: { jwt: "TOK" }, sessionStorage: { r: "R" } },
      LISTING,
    )!;
    expect(script).toContain("window.location.origin");
    expect(script).toContain("https://jobinja.ir");
    expect(script).toContain("localStorage");
    expect(script).toContain("sessionStorage");
    // The values ARE embedded in the page-restore script (that is its job) — but
    // this script is sent to the BROWSER, never to a log.
    expect(script).toContain("TOK");
    expect(script).toContain("R");
  });
});
