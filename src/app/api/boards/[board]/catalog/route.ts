import "server-only";

import { json, withErrorHandling } from "@/lib/api/http";
import { getJobinjaCategories } from "@/lib/apply/boards/jobinja-categories";
import { getJobvisionCatalog } from "@/lib/apply/boards/jobvision-catalog";
import { getEEstekhdamCatalog } from "@/lib/apply/boards/eestekhdam-catalog";
import { getIranTalentCatalog } from "@/lib/apply/boards/irantalent-catalog";
import { getKarboomCatalog } from "@/lib/apply/boards/karboom-catalog";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ board: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const { board } = await context.params;
    if (board === "e-estekhdam") return json(await getEEstekhdamCatalog());
    if (board === "jobvision") return json(await getJobvisionCatalog());
    if (board === "irantalent") return json(await getIranTalentCatalog());
    if (board === "karboom") return json(await getKarboomCatalog());
    if (board === "jobinja") {
      const { categories } = await getJobinjaCategories();
      return json({
        board,
        categories: categories.map((item) => ({
          key: item.slug,
          label: item.name,
          englishLabel: item.englishName,
        })),
        employmentTypes: [
          { key: "is_fulltime", label: "تمام‌وقت", englishLabel: "Full time" },
          { key: "is_parttime", label: "پاره‌وقت", englishLabel: "Part time" },
        ],
      });
    }
    return json({ error: "board catalog is not available" }, 404);
  });
}
