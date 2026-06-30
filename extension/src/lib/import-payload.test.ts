/**
 * The legitimacy-critical test (§10 RULE 1): PROVE the import payload carries NO
 * credential material — only profile DATA. This is the runtime chokepoint behind
 * the "imports send DATA, not sessions" invariant.
 */
import { describe, it, expect } from "vitest";
import {
  buildImportPayload,
  assertNoSecrets,
  SecretLeakError,
} from "@ext/lib/import-payload";
import type { ScrapedProfile } from "@ext/lib/import-types";

const clean: ScrapedProfile = {
  fullName: "علی رضایی",
  headline: "توسعه‌دهنده بک‌اند",
  city: "تهران",
  skills: ["Node.js", "PostgreSQL"],
  yearsExperience: 5,
  resumeText: "خلاصه‌ی حرفه‌ای",
  applications: [{ title: "بک‌اند", company: "شرکت الف", status: "بررسی‌شده" }],
};

describe("buildImportPayload", () => {
  it("wraps clean DATA as { board, payload } and nothing else", () => {
    const body = buildImportPayload("jobinja", clean);
    expect(Object.keys(body).sort()).toEqual(["board", "payload"]);
    expect(body.board).toBe("jobinja");
    expect(body.payload.fullName).toBe("علی رضایی");
    expect(body.payload.skills).toEqual(["Node.js", "PostgreSQL"]);
  });

  it("drops empty/undefined top-level fields", () => {
    const body = buildImportPayload("jobvision", {
      fullName: "  ",
      headline: undefined,
      skills: [],
      city: "اصفهان",
    } as ScrapedProfile);
    expect("fullName" in body.payload).toBe(false);
    expect("headline" in body.payload).toBe(false);
    expect("skills" in body.payload).toBe(false);
    expect(body.payload.city).toBe("اصفهان");
  });

  it("never contains any credential-shaped key in the serialized body", () => {
    const body = buildImportPayload("irantalent", clean);
    const serialized = JSON.stringify(body).toLowerCase();
    for (const bad of [
      "cookie",
      "token",
      "password",
      "secret",
      "session",
      "jwt",
      "bearer",
      "authorization",
      "csrf",
      "apikey",
    ]) {
      expect(serialized.includes(`"${bad}`)).toBe(false);
    }
  });

  it.each([
    "cookie",
    "sessionCookie",
    "token",
    "accessToken",
    "refreshToken",
    "password",
    "jwt",
    "authorization",
    "bearerToken",
    "csrfToken",
    "apiKey",
    "credential",
    "set-cookie",
    "otp",
  ])("THROWS when a credential-shaped key sneaks into the DATA: %s", (key) => {
    const dirty = { ...clean, [key]: "leaked-secret-value" } as unknown as ScrapedProfile;
    expect(() => buildImportPayload("jobinja", dirty)).toThrow(SecretLeakError);
  });

  it("THROWS when a credential is buried deep in a nested array element", () => {
    const dirty = {
      ...clean,
      applications: [{ title: "x", sessionToken: "leaked" }],
    } as unknown as ScrapedProfile;
    expect(() => buildImportPayload("e-estekhdam", dirty)).toThrow(SecretLeakError);
  });

  it("strips non-serializable values (functions/DOM) via the JSON firewall", () => {
    const withGarbage = {
      fullName: "نام",
      // A function cannot survive JSON.stringify — it must be gone from payload.
      evil: () => "x",
    } as unknown as ScrapedProfile;
    const body = buildImportPayload("jobinja", withGarbage);
    expect("evil" in body.payload).toBe(false);
    expect(body.payload.fullName).toBe("نام");
  });

  it("the thrown error names the offending field path", () => {
    try {
      buildImportPayload("jobinja", { ...clean, authToken: "x" } as unknown as ScrapedProfile);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SecretLeakError);
      expect((e as SecretLeakError).field).toContain("authToken");
    }
  });
});

describe("assertNoSecrets (fail-closed guard)", () => {
  it("passes for a clean DATA object", () => {
    expect(() => assertNoSecrets({ board: "jobinja", payload: clean })).not.toThrow();
  });

  it("recurses into nested objects and arrays to catch a buried secret", () => {
    expect(() =>
      assertNoSecrets({ payload: { nested: [{ deep: { cookie: "x" } }] } }),
    ).toThrow(SecretLeakError);
  });

  it("rejects pathologically deep nesting (depth cap)", () => {
    // Build a chain deeper than the cap.
    let node: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 20; i++) node = { child: node };
    expect(() => assertNoSecrets(node)).toThrow(SecretLeakError);
  });
});
