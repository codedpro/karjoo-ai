/**
 * session-snapshot — the LOCAL session model + vault-refresh body builder.
 * Proves: the NON-secret descriptor exposes names/keys only (never values), and
 * the vault body is built only when there is material (and carries the session
 * for the ONLY sanctioned transmission — /api/session/refresh).
 */
import { describe, it, expect } from "vitest";
import {
  describeSnapshot,
  snapshotHasMaterial,
  buildSessionRefreshBody,
  serializeSnapshot,
  type SessionSnapshot,
} from "@ext/lib/session-snapshot";

const cookieSnap: SessionSnapshot = {
  board: "jobinja",
  shape: "cookie",
  cookies: [
    { name: "jobinja_session", value: "SECRET-COOKIE-VALUE" },
    { name: "XSRF-TOKEN", value: "SECRET-XSRF" },
  ],
  capturedAt: 1_700_000_000_000,
};

const tokenSnap: SessionSnapshot = {
  board: "jobvision",
  shape: "token",
  storage: {
    localStorage: { access_token: "SECRET-JWT", theme: "dark" },
    sessionStorage: { tmp: "SECRET-TMP" },
  },
  capturedAt: 1_700_000_000_000,
};

describe("describeSnapshot — NON-secret descriptor (names/keys only)", () => {
  it("exposes cookie NAMES, never values", () => {
    const d = describeSnapshot(cookieSnap);
    expect(d.cookieNames).toEqual(["XSRF-TOKEN", "jobinja_session"]);
    const s = JSON.stringify(d);
    expect(s).not.toContain("SECRET-COOKIE-VALUE");
    expect(s).not.toContain("SECRET-XSRF");
  });

  it("exposes storage KEYS, never values", () => {
    const d = describeSnapshot(tokenSnap);
    expect(d.storageKeys).toEqual(["access_token", "theme", "tmp"]);
    const s = JSON.stringify(d);
    expect(s).not.toContain("SECRET-JWT");
    expect(s).not.toContain("SECRET-TMP");
  });
});

describe("snapshotHasMaterial", () => {
  it("true when cookies/storage present", () => {
    expect(snapshotHasMaterial(cookieSnap)).toBe(true);
    expect(snapshotHasMaterial(tokenSnap)).toBe(true);
  });
  it("false when empty", () => {
    expect(
      snapshotHasMaterial({ board: "jobinja", shape: "cookie", capturedAt: 0, cookies: [] }),
    ).toBe(false);
  });
});

describe("buildSessionRefreshBody — vault push body (premium only)", () => {
  it("returns null when there is no material (nothing to push)", () => {
    const body = buildSessionRefreshBody({
      board: "jobinja",
      shape: "cookie",
      capturedAt: 0,
      cookies: [],
    });
    expect(body).toBeNull();
  });

  it("matches the server sessionRefreshBodySchema shape exactly", () => {
    const body = buildSessionRefreshBody(cookieSnap, "Mozilla/5.0 (user UA)")!;
    expect(body.board).toBe("jobinja");
    // Only the allowed top-level keys (server is `.strict()`).
    expect(Object.keys(body).sort()).toEqual(["board", "session"]);
    // The session bundle carries the user's OWN cookies (the one sanctioned
    // transmission, to the user's own encrypted vault).
    expect(body.session.cookies).toHaveLength(2);
    expect(body.session.cookies![0]!.name).toBe("jobinja_session");
    expect(body.session.userAgent).toBe("Mozilla/5.0 (user UA)");
    expect(typeof body.session.capturedAt).toBe("string");
    // The material IS present in the bundle (it's the vault payload).
    expect(JSON.stringify(body.session)).toContain("SECRET-COOKIE-VALUE");
  });

  it("emits storage maps (not cookies) for a token-shaped board", () => {
    const body = buildSessionRefreshBody(tokenSnap)!;
    expect(body.session.cookies).toBeUndefined();
    expect(body.session.localStorage).toEqual({ access_token: "SECRET-JWT", theme: "dark" });
    expect(body.session.sessionStorage).toEqual({ tmp: "SECRET-TMP" });
  });

  it("serializeSnapshot is a stable local-only helper (not the wire body)", () => {
    expect(serializeSnapshot(cookieSnap)).toContain("SECRET-COOKIE-VALUE");
  });
});
