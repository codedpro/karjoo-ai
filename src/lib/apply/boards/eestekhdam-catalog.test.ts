import { describe, expect, it, vi } from "vitest";

import { getEEstekhdamCatalog } from "@/lib/apply/boards/eestekhdam-catalog";

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

    const result = await getEEstekhdamCatalog(fetchMock as unknown as typeof fetch);
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
});
