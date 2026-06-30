/**
 * The legitimacy-critical test: PROVE the connect payload carries NO secret
 * material — only { board, status, accountLabel }. This is the runtime guard
 * behind docs §10 RULE 1.
 */
import { describe, it, expect } from "vitest";
import {
  buildConnectPayload,
  assertNoSecrets,
  SecretLeakError,
} from "@ext/lib/connect-payload";

describe("buildConnectPayload", () => {
  it("emits ONLY board + status:'connected' (+ optional label)", () => {
    const payload = buildConnectPayload({ board: "jobinja" });
    expect(payload).toEqual({ board: "jobinja", status: "connected" });
    // The exact key set is the whole point — assert it is exhaustive.
    expect(Object.keys(payload).sort()).toEqual(["board", "status"]);
  });

  it("includes a trimmed accountLabel when provided", () => {
    const payload = buildConnectPayload({ board: "jobvision", accountLabel: "  حساب اصلی  " });
    expect(payload).toEqual({ board: "jobvision", status: "connected", accountLabel: "حساب اصلی" });
  });

  it("omits an empty/whitespace-only label rather than sending it", () => {
    const payload = buildConnectPayload({ board: "jobinja", accountLabel: "   " });
    expect("accountLabel" in payload).toBe(false);
  });

  it("never contains any secret-shaped key", () => {
    const payload = buildConnectPayload({ board: "jobinja", accountLabel: "x" });
    const keys = Object.keys(payload).join(" ").toLowerCase();
    for (const bad of ["cookie", "token", "password", "secret", "credential", "session", "jwt", "auth"]) {
      expect(keys).not.toContain(bad);
    }
  });

  it("status is always exactly 'connected' (a boolean attestation, not a secret)", () => {
    expect(buildConnectPayload({ board: "jobvision" }).status).toBe("connected");
  });
});

describe("assertNoSecrets (fail-closed guard)", () => {
  it("passes for a clean metadata object", () => {
    expect(() => assertNoSecrets({ board: "jobinja", status: "connected" })).not.toThrow();
  });

  it.each([
    "cookie",
    "sessionCookie",
    "token",
    "accessToken",
    "password",
    "jwt",
    "authToken",
    "csrf",
    "apiKey",
    "bearer",
    "credential",
  ])("throws SecretLeakError when a key looks secret: %s", (key) => {
    expect(() => assertNoSecrets({ board: "jobinja", [key]: "leaked" })).toThrow(SecretLeakError);
  });

  it("throws for any key outside the allow-list, even if not obviously secret", () => {
    expect(() => assertNoSecrets({ board: "jobinja", status: "connected", extra: "nope" })).toThrow(
      SecretLeakError,
    );
  });

  it("recurses into nested objects to catch a buried secret", () => {
    // accountLabel is allowed, but a nested object under it must still be scanned.
    expect(() =>
      assertNoSecrets({ accountLabel: { cookie: "x" } as unknown as string }),
    ).toThrow(SecretLeakError);
  });
});
