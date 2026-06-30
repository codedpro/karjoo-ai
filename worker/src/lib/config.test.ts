/**
 * Config tests — env parsing, required-field failures, clamping, politeness.
 */
import { describe, expect, it } from "vitest";

import { loadConfig, politenessDelayMs, WorkerConfigError } from "./config.js";

const MIN = { KARJOO_API: "https://k.test/", KARJOO_NODE_KEY: "n1" };

describe("loadConfig", () => {
  it("requires KARJOO_API", () => {
    expect(() => loadConfig({ KARJOO_NODE_KEY: "n" })).toThrow(WorkerConfigError);
  });
  it("requires KARJOO_NODE_KEY", () => {
    expect(() => loadConfig({ KARJOO_API: "https://k" })).toThrow(WorkerConfigError);
  });

  it("strips the trailing slash from the api base", () => {
    expect(loadConfig(MIN).apiBase).toBe("https://k.test");
  });

  it("applies sane defaults and reads the enrollment token", () => {
    const cfg = loadConfig({ ...MIN, KARJOO_FLEET_ENROLLMENT_TOKEN: "tok" });
    expect(cfg.enrollmentToken).toBe("tok");
    expect(cfg.claimLimit).toBe(5);
    expect(cfg.headless).toBe(false);
    expect(cfg.updateScript).toBe("./update.sh");
    expect(cfg.browserExecutablePath).toBeNull();
  });

  it("clamps claimLimit into 1..25", () => {
    expect(loadConfig({ ...MIN, KARJOO_CLAIM_LIMIT: "999" }).claimLimit).toBe(25);
    expect(loadConfig({ ...MIN, KARJOO_CLAIM_LIMIT: "0" }).claimLimit).toBe(1);
  });

  it("reads the browser path and headless flag", () => {
    const cfg = loadConfig({ ...MIN, KARJOO_BROWSER_PATH: "/usr/bin/chromium", KARJOO_HEADLESS: "true" });
    expect(cfg.browserExecutablePath).toBe("/usr/bin/chromium");
    expect(cfg.headless).toBe(true);
  });
});

describe("politenessDelayMs", () => {
  it("is base + floor(rand*(jitter+1)), within base..base+jitter", () => {
    const cfg = { politenessBaseMs: 1000, politenessJitterMs: 500 };
    // rand=0 → exactly base; rand just under 1 → base + jitter.
    expect(politenessDelayMs(cfg, () => 0)).toBe(1000);
    expect(politenessDelayMs(cfg, () => 0.999)).toBe(1500);
    const mid = politenessDelayMs(cfg, () => 0.5);
    expect(mid).toBeGreaterThanOrEqual(1000);
    expect(mid).toBeLessThanOrEqual(1500);
  });
});
