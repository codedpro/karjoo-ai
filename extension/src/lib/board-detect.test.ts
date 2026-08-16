/**
 * Board-session detection tests (pure logic).
 *
 * These prove the detector returns a BOOLEAN from session-shaped signals and
 * never depends on (or leaks) the secret value — only key NAMES/presence.
 */
import { describe, it, expect } from "vitest";
import {
  jobinjaLoggedIn,
  jobvisionLoggedIn,
  eEstekhdamLoggedIn,
  irantalentLoggedIn,
  sessionCookieNames,
  sessionTokenKeys,
  sessionShapeOf,
} from "@ext/lib/board-detect";

describe("jobinjaLoggedIn (cookie-shaped)", () => {
  it("true when a known session cookie is present with a value", () => {
    expect(jobinjaLoggedIn([{ name: "jobinja_session", value: "abc123" }])).toBe(true);
    expect(jobinjaLoggedIn([{ name: "laravel_session", value: "x" }])).toBe(true);
    expect(jobinjaLoggedIn([{ name: "remember_web_xyz", value: "x" }])).toBe(true);
  });

  it("false when no session cookie present", () => {
    expect(jobinjaLoggedIn([{ name: "_ga", value: "GA1.2" }])).toBe(false);
    expect(jobinjaLoggedIn([])).toBe(false);
  });

  it("false for an empty-valued (logged-out remnant) session cookie", () => {
    expect(jobinjaLoggedIn([{ name: "jobinja_session", value: "" }])).toBe(false);
  });

  it("treats presence as enough when value is omitted by the caller", () => {
    // The detector must work even if the caller deliberately withholds values.
    expect(jobinjaLoggedIn([{ name: "PHPSESSID" }])).toBe(true);
  });
});

describe("jobvisionLoggedIn (token-shaped, localStorage key names only)", () => {
  it("true when an auth-token key is present", () => {
    expect(jobvisionLoggedIn(["CandidateClient_v2"])).toBe(true);
    expect(jobvisionLoggedIn(["token"])).toBe(true);
    expect(jobvisionLoggedIn(["foo", "access_token"])).toBe(true);
    expect(jobvisionLoggedIn(["userToken"])).toBe(true);
  });
  it("is case-insensitive on key names", () => {
    expect(jobvisionLoggedIn(["TOKEN"])).toBe(true);
  });
  it("false when only non-auth keys present", () => {
    expect(jobvisionLoggedIn(["theme", "lang"])).toBe(false);
    expect(jobvisionLoggedIn([])).toBe(false);
  });
});

describe("eEstekhdamLoggedIn (cookie-shaped)", () => {
  it("true when a known session cookie is present with a value", () => {
    expect(eEstekhdamLoggedIn([{ name: "estekhdam_session", value: "abc" }])).toBe(true);
    expect(eEstekhdamLoggedIn([{ name: "laravel_session", value: "x" }])).toBe(true);
  });
  it("false with no session cookie / empty value", () => {
    expect(eEstekhdamLoggedIn([{ name: "_ga", value: "x" }])).toBe(false);
    expect(eEstekhdamLoggedIn([{ name: "PHPSESSID", value: "" }])).toBe(false);
    expect(eEstekhdamLoggedIn([])).toBe(false);
  });
});

describe("irantalentLoggedIn (token-shaped, key names only)", () => {
  it("true when an auth-token key is present (case-insensitive)", () => {
    expect(irantalentLoggedIn(["id_token"])).toBe(true);
    expect(irantalentLoggedIn(["ACCESS_TOKEN"])).toBe(true);
  });
  it("false when only non-auth keys present", () => {
    expect(irantalentLoggedIn(["lang", "theme"])).toBe(false);
    expect(irantalentLoggedIn([])).toBe(false);
  });
});

describe("which signals to probe per board", () => {
  it("jobinja → cookie names, no localStorage keys", () => {
    expect(sessionCookieNames("jobinja").length).toBeGreaterThan(0);
    expect(sessionTokenKeys("jobinja")).toEqual([]);
  });
  it("jobvision → localStorage keys, no cookie names", () => {
    expect(sessionTokenKeys("jobvision").length).toBeGreaterThan(0);
    expect(sessionCookieNames("jobvision")).toEqual([]);
  });
  it("e-estekhdam → cookie names (server-rendered)", () => {
    expect(sessionCookieNames("e-estekhdam").length).toBeGreaterThan(0);
    expect(sessionTokenKeys("e-estekhdam")).toEqual([]);
  });
  it("irantalent → localStorage keys (SPA)", () => {
    expect(sessionTokenKeys("irantalent").length).toBeGreaterThan(0);
    expect(sessionCookieNames("irantalent")).toEqual([]);
  });
});

describe("sessionShapeOf", () => {
  it("maps each board to cookie/token", () => {
    expect(sessionShapeOf("jobinja")).toBe("cookie");
    expect(sessionShapeOf("e-estekhdam")).toBe("cookie");
    expect(sessionShapeOf("jobvision")).toBe("token");
    expect(sessionShapeOf("irantalent")).toBe("token");
  });
});
