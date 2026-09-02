import { describe, expect, it } from "vitest";

import {
  MAX_PROVIDER_SYNC_AGE_DAYS,
  clampProviderAgeDays,
  providerCutoffMs,
} from "@ext/lib/freshness";

describe("extension provider freshness policy", () => {
  it("caps provider discovery at the shared maximum", () => {
    expect(clampProviderAgeDays(90)).toBe(MAX_PROVIDER_SYNC_AGE_DAYS);
    expect(clampProviderAgeDays(0)).toBe(1);
    expect(clampProviderAgeDays(undefined)).toBe(MAX_PROVIDER_SYNC_AGE_DAYS);
  });

  it("computes the cutoff from the clamped age", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(providerCutoffMs(90, now)).toBe(now - MAX_PROVIDER_SYNC_AGE_DAYS * 86_400_000);
  });
});
