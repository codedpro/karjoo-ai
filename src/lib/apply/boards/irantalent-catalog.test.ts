/**
 * IranTalent catalog tests. The site is a client-rendered SPA, so the catalog
 * must come from the public lookup API — and pick exactly the two lookup types
 * the job-search filter uses, keyed by the ids the search body expects.
 */
import { describe, it, expect, vi } from "vitest";

import {
  getIranTalentCatalog,
  parseIranTalentLookup,
} from "@/lib/apply/boards/irantalent-catalog";

const LOOKUP = {
  last_updated_date: "2026-08-31",
  data: [
    { id: 342, type: "42", title: "Business & Data Analysis", title_farsi: "تحلیل داده", slug: "bda-filter" },
    { id: 339, type: "42", title: "PR & Communication", title_farsi: "ارتباطات", slug: "pr-communication" },
    { id: 186, type: "17", title: "Full Time", title_farsi: "تمام وقت", slug: "Full-Time-employment-type" },
    { id: 187, type: "17", title: "Part Time", title_farsi: "نیمه وقت", slug: "Part-Time-employment-type" },
    { id: 560, type: "47", title: "hybrid", title_farsi: "ترکیبی", slug: "hybrid" },
    { id: 79, type: "23", title: "Arabic", title_farsi: "عربی", slug: "arabic" },
  ],
};

describe("parseIranTalentLookup", () => {
  it("keeps only job-category (42) and employment-type (17) rows", () => {
    const catalog = parseIranTalentLookup(LOOKUP);
    expect(catalog.board).toBe("irantalent");
    expect(catalog.categories.map((c) => c.key).sort()).toEqual(["339", "342"]);
    expect(catalog.employmentTypes.map((c) => c.key).sort()).toEqual(["186", "187"]);
  });

  it("keys options by lookup id, because the search API filters by id", () => {
    const fullTime = parseIranTalentLookup(LOOKUP).employmentTypes.find((o) => o.key === "186");
    expect(fullTime).toEqual({ key: "186", label: "تمام وقت", englishLabel: "Full Time" });
  });

  it("falls back to the English title when no Persian label exists", () => {
    const catalog = parseIranTalentLookup({
      data: [{ id: 9, type: "42", title: "Only English", title_farsi: "  " }],
    });
    expect(catalog.categories).toEqual([{ key: "9", label: "Only English", englishLabel: "Only English" }]);
  });

  it("drops rows with no usable id or label instead of inventing one", () => {
    const catalog = parseIranTalentLookup({
      data: [
        { type: "42", title: "No id" },
        { id: 4, type: "42", title: "  ", title_farsi: "" },
      ],
    });
    expect(catalog.categories).toEqual([]);
  });

  it("tolerates a missing or malformed payload", () => {
    expect(parseIranTalentLookup(null).categories).toEqual([]);
    expect(parseIranTalentLookup({ data: "nope" }).employmentTypes).toEqual([]);
  });
});

describe("getIranTalentCatalog", () => {
  it("reads the public lookup endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ ...LOOKUP, requested: url }), { status: 200 }));
    const catalog = await getIranTalentCatalog(fetchImpl as unknown as typeof fetch);
    expect(catalog.categories).toHaveLength(2);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/public-area/lookup/all");
  });

  it("throws rather than serving an empty catalog", async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(getIranTalentCatalog(empty as unknown as typeof fetch)).rejects.toThrow(/no categories/);
    const failing = vi.fn(async () => new Response("", { status: 503 }));
    await expect(getIranTalentCatalog(failing as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});
