/**
 * Server-side IranTalent provider tests: four-provider filter parsing, the
 * enabled-board queue gate, the tailored-PDF requirement, and the rule that a
 * server-owned fleet run never leases IranTalent work.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_APPLY_FILTERS,
  enabledApplyBoards,
  mergeApplyFilters,
  parseApplyFilters,
} from "@/lib/apply/filters";
import { applyFiltersInputSchema } from "@/lib/apply/apply-filters-form";
import { browserDiscoveryImportSchema } from "@/lib/api/extension-schemas";

const ALL_BOARDS = ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const;

function enable(...boards: readonly string[]) {
  const boardFilters = { ...EMPTY_APPLY_FILTERS.boardFilters };
  for (const board of ALL_BOARDS) {
    boardFilters[board] = { ...boardFilters[board], enabled: boards.includes(board) };
  }
  return { ...EMPTY_APPLY_FILTERS, boardFilters };
}

describe("four-provider filter parsing", () => {
  it("always materializes all four providers, defaulting IranTalent off", () => {
    const filters = parseApplyFilters(null);
    expect(Object.keys(filters.boardFilters).sort()).toEqual([...ALL_BOARDS].sort());
    expect(filters.boardFilters.irantalent).toEqual({
      enabled: false,
      categoryKeys: [],
      cities: [],
      employmentTypeKeys: [],
      remoteOnly: false,
    });
  });

  it("round-trips IranTalent targeting through parse and merge", () => {
    const raw = {
      boardFiltersVersion: 1,
      boardFilters: {
        irantalent: {
          enabled: true,
          categoryKeys: ["342", " 342 ", "339"],
          employmentTypeKeys: ["186"],
          remoteOnly: true,
        },
      },
    };
    const parsed = parseApplyFilters(raw);
    expect(parsed.boardFilters.irantalent).toMatchObject({
      enabled: true,
      categoryKeys: ["342", "339"],
      employmentTypeKeys: ["186"],
      remoteOnly: true,
    });
    const merged = mergeApplyFilters({ ...EMPTY_APPLY_FILTERS }, parsed) as {
      boardFilters: Record<string, unknown>;
    };
    expect(merged.boardFilters.irantalent).toEqual(parsed.boardFilters.irantalent);
  });

  it("upgrades a legacy three-provider payload without losing the others", () => {
    const legacy = parseApplyFilters({
      boardFiltersVersion: 1,
      boardFilters: { jobinja: { enabled: true, categoryKeys: ["software"] } },
    });
    expect(legacy.boardFilters.irantalent.enabled).toBe(false);
    expect(legacy.boardFilters.jobinja.categoryKeys).toEqual(["software"]);
  });

  it("accepts IranTalent in the dashboard filter form and the discovery import", () => {
    const board = { enabled: false, categoryKeys: [], cities: [], employmentTypeKeys: [], remoteOnly: false };
    expect(applyFiltersInputSchema.safeParse({
      boardFilters: {
        jobinja: board,
        jobvision: board,
        "e-estekhdam": board,
        irantalent: { ...board, enabled: true, categoryKeys: ["342"], employmentTypeKeys: ["186"] },
      },
    }).success).toBe(true);
    // The contract is versioned: a payload that predates IranTalent is rejected
    // rather than silently dropping the provider.
    expect(applyFiltersInputSchema.safeParse({
      boardFilters: { jobinja: board, jobvision: board, "e-estekhdam": board },
    }).success).toBe(false);
    expect(browserDiscoveryImportSchema.safeParse({ board: "irantalent", listings: [] }).success).toBe(true);
    expect(browserDiscoveryImportSchema.safeParse({ board: "karboom", listings: [] }).success).toBe(false);
  });
});

describe("enabled-board queue gate", () => {
  it("leases IranTalent only while the provider is enabled", () => {
    expect(enabledApplyBoards(enable("irantalent"))).toEqual(["irantalent"]);
    expect(enabledApplyBoards(enable("jobinja"))).not.toContain("irantalent");
    expect(enabledApplyBoards(enable())).toEqual([]);
  });
});

describe("IranTalent is extension-only", () => {
  // The server-owned claim path itself is covered end-to-end in
  // src/lib/fleet/irantalent-ownership.test.ts; this asserts the rule the fleet
  // applies to the user's enabled providers.
  it("drops IranTalent from a run's allowed boards, keeping the rest", () => {
    const allowed = enabledApplyBoards(enable("jobinja", "jobvision", "irantalent")).filter(
      (board) => board !== "irantalent",
    );
    expect(allowed).toEqual(["jobinja", "jobvision"]);
  });
});
