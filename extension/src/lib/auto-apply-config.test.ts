/**
 * auto-apply-config — politeness jitter math (pure, deterministic via injected RNG).
 */
import { describe, it, expect } from "vitest";
import {
  politenessDelayMs,
  JITTER_MS_MIN,
  JITTER_MS_MAX,
  AUTO_APPLY_ALARM_MINUTES,
  SESSION_REFRESH_MINUTES,
  MAX_APPLIES_PER_TICK,
} from "@ext/lib/auto-apply-config";

describe("politenessDelayMs", () => {
  it("returns the floor when rng=0", () => {
    expect(politenessDelayMs(() => 0)).toBe(Math.min(JITTER_MS_MIN, JITTER_MS_MAX));
  });
  it("returns the ceiling when rng=1", () => {
    expect(politenessDelayMs(() => 1)).toBe(Math.max(JITTER_MS_MIN, JITTER_MS_MAX));
  });
  it("returns the midpoint when rng=0.5", () => {
    const lo = Math.min(JITTER_MS_MIN, JITTER_MS_MAX);
    const hi = Math.max(JITTER_MS_MIN, JITTER_MS_MAX);
    expect(politenessDelayMs(() => 0.5)).toBe(Math.round(lo + 0.5 * (hi - lo)));
  });
  it("clamps an out-of-range rng", () => {
    expect(politenessDelayMs(() => 5)).toBe(Math.max(JITTER_MS_MIN, JITTER_MS_MAX));
    expect(politenessDelayMs(() => -5)).toBe(Math.min(JITTER_MS_MIN, JITTER_MS_MAX));
    expect(politenessDelayMs(() => NaN)).toBe(Math.min(JITTER_MS_MIN, JITTER_MS_MAX));
  });
});

describe("config defaults mirror the control plane", () => {
  it("has sane defaults", () => {
    expect(AUTO_APPLY_ALARM_MINUTES).toBeGreaterThan(0);
    expect(SESSION_REFRESH_MINUTES).toBeGreaterThan(0);
    expect(MAX_APPLIES_PER_TICK).toBeGreaterThan(0);
    expect(JITTER_MS_MIN).toBeLessThanOrEqual(JITTER_MS_MAX);
  });
});
