import { describe, expect, it } from "vitest";

import {
  deriveProviderState,
  needsKarjooReconcile,
  reconciledProviderState,
  withProviderEnabled,
} from "@ext/lib/provider-manager";
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
    irantalent: { enabled: false, categoryKeys: [], cities: [], employmentTypeKeys: [], remoteOnly: false },
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

describe("deriveProviderState across every active provider", () => {
  const probe = { loggedIn: true } as const;
  it("reports each of the four providers with its own board id", () => {
    for (const board of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
      const state = deriveProviderState({ board, enabled: true, serverStatus: "connected", probe });
      expect(state).toMatchObject({ board, state: "connected", localSession: true });
    }
  });

  it("keeps the probe's bounded reason so the UI can say what is actually wrong", () => {
    for (const reason of ["no_tab", "logged_out", "security_challenge", "probe_unavailable"] as const) {
      const state = deriveProviderState({
        board: "irantalent",
        enabled: true,
        serverStatus: "connected",
        probe: { loggedIn: false, reason },
      });
      expect(state).toMatchObject({ state: "login_required", reason });
    }
  });
});

describe("needsKarjooReconcile", () => {
  const base = (overrides: Partial<ReturnType<typeof deriveProviderState>>) => ({
    ...deriveProviderState({
      board: "irantalent",
      enabled: true,
      serverStatus: null,
      probe: { loggedIn: true },
    }),
    ...overrides,
  });

  it("reconciles when a real local session outranks stale Karjoo metadata", () => {
    expect(needsKarjooReconcile(base({}))).toBe(true);
    expect(needsKarjooReconcile(base({ serverStatus: "needs_reauth" }))).toBe(true);
  });

  it("is idempotent — an already-connected provider never writes again", () => {
    const reconciled = reconciledProviderState(base({}));
    expect(reconciled).toMatchObject({ state: "connected", serverStatus: "connected" });
    expect(needsKarjooReconcile(reconciled)).toBe(false);
    expect(needsKarjooReconcile(reconciledProviderState(reconciled))).toBe(false);
  });

  it("never undoes an explicit Karjoo disconnect, which also disables the provider", () => {
    expect(needsKarjooReconcile(base({ enabled: false }))).toBe(false);
  });

  it("does not claim a connection the browser cannot back up", () => {
    expect(needsKarjooReconcile(base({ localSession: false }))).toBe(false);
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

  it("carries every active provider through, including IranTalent", () => {
    const next = withProviderEnabled(filters, "irantalent", true);
    expect(next.boardFilters.irantalent.enabled).toBe(true);
    expect(Object.keys(next.boardFilters).sort()).toEqual(
      ["e-estekhdam", "irantalent", "jobinja", "jobvision"],
    );
    expect(next.boardFilters["e-estekhdam"]).toEqual(filters.boardFilters["e-estekhdam"]);
  });
});
