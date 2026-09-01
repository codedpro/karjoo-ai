/**
 * A selected category key must be visible to the user, or they cannot remove it.
 *
 * An account was searching Jobinja for "sales and marketing" it never picked: the
 * stored key was an INTERNAL slug (`marketing-sales`), which buildSearchUrl
 * happily translates into a live `filters[job_categories][]` value — but the
 * dashboard draws a checkbox per catalog entry, so the key rendered nothing and
 * could not be unchecked. These tests pin the two halves of that.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import { toJobinjaCategorySlug } from "@/lib/apply/boards/jobinja-categories";

describe("internal slugs reach the real search", () => {
  it("translates an internal slug into a live Jobinja category filter", () => {
    // This is why an invisible leftover key is not harmless.
    expect(toJobinjaCategorySlug("marketing-sales")).toBe("فروش-و-بازاریابی");
    const cats = new URL(buildSearchUrl({ categorySlugs: ["marketing-sales"] }, 1))
      .searchParams.getAll("filters[job_categories][]");
    expect(cats).toEqual(["فروش-و-بازاریابی"]);
  });

  it("passes a real Jobinja key straight through", () => {
    const cats = new URL(buildSearchUrl({ categorySlugs: ["iT--DevOps--Server"] }, 1))
      .searchParams.getAll("filters[job_categories][]");
    expect(cats).toEqual(["iT--DevOps--Server"]);
  });

  it("drops a key it cannot map, rather than sending nonsense", () => {
    const cats = new URL(buildSearchUrl({ categorySlugs: ["not-a-real-category"] }, 1))
      .searchParams.getAll("filters[job_categories][]");
    expect(cats).toEqual([]);
  });
});

describe("the editor surfaces keys the catalog does not contain", () => {
  it("keeps the unknown-key notice wired to the selection, not to the catalog", () => {
    const source = readFileSync("src/components/dashboard/board-targeting-editor.tsx", "utf8");
    expect(source).toContain("unknownKeys");
    // Derived from what is SELECTED minus what the catalog offers — the only way
    // an unrecognized key becomes visible.
    expect(source).toMatch(/board\.categoryKeys\.filter\(\(key\) =>\s*!catalog\.categories\.some/);
  });
});
