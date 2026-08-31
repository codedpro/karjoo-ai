import { describe, expect, it } from "vitest";

import { deriveProviderState, withProviderEnabled } from "@ext/lib/provider-manager";
import type { ApplyFilters } from "@ext/lib/types";

const filters: ApplyFilters = {
  categorySlugs: ["software"],
  cities: ["تهران"],
  jobTypes: ["is_fulltime"],
  remoteOnly: false,
  aiFilterEnabled: false,
  paused: false,
  maxAgeDays: 45,
  boardFiltersVersion: 1,
  boardFilters: {
    jobinja: { enabled: true, categoryKeys: ["software"], cities: ["تهران"], employmentTypeKeys: ["is_fulltime"], remoteOnly: false },
    jobvision: { enabled: true, categoryKeys: ["web"], cities: [], employmentTypeKeys: [], remoteOnly: true },
    "e-estekhdam": { enabled: false, categoryKeys: [], cities: [], employmentTypeKeys: [], remoteOnly: false },
  },
};

describe("deriveProviderState", () => {
  it("distinguishes connected, paused, login-required, and Karjoo-disconnected states", () => {
    expect(deriveProviderState({ board: "jobinja", enabled: true, serverStatus: "connected", probe: { loggedIn: true } }).state).toBe("connected");
    expect(deriveProviderState({ board: "jobinja", enabled: false, serverStatus: "connected", probe: { loggedIn: true } }).state).toBe("paused");
    expect(deriveProviderState({ board: "jobvision", enabled: true, serverStatus: "connected", probe: { loggedIn: false, reason: "no_tab" } }).state).toBe("login_required");
    expect(deriveProviderState({ board: "e-estekhdam", enabled: false, serverStatus: "needs_reauth", probe: { loggedIn: true } }).state).toBe("disconnected");
  });
});

describe("withProviderEnabled", () => {
  it("changes one provider and preserves every targeting selection", () => {
    const next = withProviderEnabled(filters, "jobvision", false);
    expect(next.boardFilters.jobvision.enabled).toBe(false);
    expect(next.boardFilters.jobvision.categoryKeys).toEqual(["web"]);
    expect(next.boardFilters.jobinja).toEqual(filters.boardFilters.jobinja);
    expect(next.categorySlugs).toEqual(["software"]);
  });
});
