/**
 * Board-session detection tests (pure logic).
 *
 * These prove the detector returns a BOOLEAN from session-shaped signals and
 * never depends on (or leaks) the secret value — only key NAMES/presence.
 */
import { describe, it, expect } from "vitest";
import {
  jobvisionLoggedIn,
  sessionTokenKeys,
  sessionShapeOf,
} from "@ext/lib/board-detect";


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



describe("which signals to probe per board", () => {
  it("jobinja → cookie names, no localStorage keys", () => {
    expect(sessionTokenKeys("jobinja")).toEqual([]);
  });
  it("jobvision → localStorage keys, no cookie names", () => {
    expect(sessionTokenKeys("jobvision").length).toBeGreaterThan(0);
  });
  it("e-estekhdam → cookie names (server-rendered)", () => {
    expect(sessionTokenKeys("e-estekhdam")).toEqual([]);
  });
  it("irantalent → cookie names (SPA with a first-party auth cookie)", () => {
    expect(sessionTokenKeys("irantalent")).toEqual([]);
  });
});

describe("sessionShapeOf", () => {
  it("maps each board to cookie/token", () => {
    expect(sessionShapeOf("jobinja")).toBe("cookie");
    expect(sessionShapeOf("e-estekhdam")).toBe("cookie");
    expect(sessionShapeOf("jobvision")).toBe("token");
    expect(sessionShapeOf("irantalent")).toBe("cookie");
  });
});

describe("no board decides login from guessed cookie names any more", () => {
  it("exposes no cookie-name login helper — that was the Jobinja false positive", async () => {
    const module = await import("@ext/lib/board-detect");
    for (const removed of [
      "jobinjaLoggedIn",
      "eEstekhdamLoggedIn",
      "irantalentLoggedIn",
      "sessionCookieNames",
    ]) {
      expect(module, removed).not.toHaveProperty(removed);
    }
  });

  it("keeps only the session SHAPE, which the refresh path still needs", () => {
    expect(sessionShapeOf("jobinja")).toBe("cookie");
    expect(sessionShapeOf("e-estekhdam")).toBe("cookie");
    expect(sessionShapeOf("irantalent")).toBe("cookie");
    expect(sessionShapeOf("jobvision")).toBe("token");
  });
});
