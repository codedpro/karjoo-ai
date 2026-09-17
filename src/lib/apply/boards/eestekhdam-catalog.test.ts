import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_EESTEKHDAM_CATALOG,
  getEEstekhdamCatalog,
  resetEEstekhdamCatalogCache,
} from "@/lib/apply/boards/eestekhdam-catalog";

let diskPath: string;

beforeEach(() => {
  resetEEstekhdamCatalogCache();
  diskPath = join(mkdtempSync(join(tmpdir(), "eestekhdam-")), "catalog.json");
});

describe("getEEstekhdamCatalog", () => {
  it("flattens leaf positions and keeps native contract keys", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        positions: [
          {
            key: "technology",
            label: "فناوری",
            items: [
              { key: "برنامه-نویس", label: "برنامه نویس" },
              { key: "متخصص-SEO", label: "متخصص SEO" },
            ],
          },
        ],
        contracts: [
          { key: "تمام-وقت", label: "تمام وقت" },
          { key: "دورکاری", label: "دورکاری" },
        ],
      },
    }), { status: 201 }));

    const result = await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, { diskPath });
    expect(result).toEqual({
      board: "e-estekhdam",
      categories: [
        { key: "برنامه-نویس", label: "برنامه نویس", englishLabel: "" },
        { key: "متخصص-SEO", label: "متخصص SEO", englishLabel: "" },
      ],
      employmentTypes: [
        { key: "تمام-وقت", label: "تمام وقت", englishLabel: "" },
        { key: "دورکاری", label: "دورکاری", englishLabel: "" },
      ],
    });
  });

  it("keeps the last good catalog on disk", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { positions: [{ key: "برنامه-نویس", label: "برنامه نویس" }], contracts: [] },
    })));
    await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, { diskPath });
    expect(JSON.parse(readFileSync(diskPath, "utf8")).categories).toHaveLength(1);
  });

  it("falls back to the disk copy when the site is unreachable", async () => {
    const saved = {
      board: "e-estekhdam",
      categories: [{ key: "مدیر", label: "مدیر", englishLabel: "" }],
      employmentTypes: [],
    };
    writeFileSync(diskPath, JSON.stringify(saved));
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, { diskPath });
    expect(result).toEqual(saved);
  });

  it("falls back to the built-in list and remembers the failure for 10 minutes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    let clock = 0;
    const opts = { diskPath, now: () => clock };
    const first = await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, opts);
    expect(first).toBe(FALLBACK_EESTEKHDAM_CATALOG);
    expect(first.categories.some((c) => c.key === "برنامه-نویس")).toBe(true);

    clock = 9 * 60_000;
    await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, opts);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock = 10 * 60_000;
    await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, opts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats an empty answer as a failure", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: {} })));
    const result = await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch, { diskPath });
    expect(result).toBe(FALLBACK_EESTEKHDAM_CATALOG);
  });
});
