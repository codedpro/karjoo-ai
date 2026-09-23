import { describe, expect, it } from "vitest";

import {
  ACTIVE_BOARDS,
  BOARD_LABELS,
  CATEGORY_OPTIONS,
  EMPLOYMENT_LABELS,
  POSTED_LABELS,
  hasActiveFilters,
  parseUnifiedJobFilters,
  unifiedFiltersToParams,
} from "@/lib/apply/job-filter-options";

const LATIN = /[A-Za-z]/;

describe("job filter options", () => {
  it("lists exactly the five active sites", () => {
    expect([...ACTIVE_BOARDS].sort()).toEqual(["e-estekhdam", "irantalent", "jobinja", "jobvision", "karboom"]);
  });

  it("has no English in any label a visitor sees", () => {
    const labels = [
      ...Object.values(BOARD_LABELS),
      ...Object.values(EMPLOYMENT_LABELS),
      ...Object.values(POSTED_LABELS),
      ...CATEGORY_OPTIONS.map((c) => c.label),
    ];
    for (const label of labels) expect(label, label).not.toMatch(LATIN);
  });
});

describe("parseUnifiedJobFilters", () => {
  it("reads every filter from the URL", () => {
    expect(
      parseUnifiedJobFilters({
        q: "  react ",
        board: "karboom",
        category: "software-development",
        city: "تهران",
        type: "part_time",
        remote: "1",
        posted: "7",
      }),
    ).toEqual({
      q: "react",
      board: "karboom",
      category: "software-development",
      city: "تهران",
      type: "part_time",
      remote: true,
      posted: 7,
    });
  });

  it("drops anything invalid — including sites that are not active", () => {
    expect(
      parseUnifiedJobFilters({ board: "linkedin", category: "nope", type: "x", remote: "yes", posted: "5" }),
    ).toEqual({ q: null, board: null, category: null, city: null, type: null, remote: false, posted: null });
  });

  it("round-trips through URL parameters", () => {
    const params = { q: "حسابدار", board: "jobinja", category: "finance-accounting", remote: "1", posted: "3" };
    const parsed = parseUnifiedJobFilters(params);
    expect(unifiedFiltersToParams(parsed)).toEqual(params);
    expect(hasActiveFilters(parsed)).toBe(true);
    expect(hasActiveFilters(parseUnifiedJobFilters({}))).toBe(false);
  });
});
