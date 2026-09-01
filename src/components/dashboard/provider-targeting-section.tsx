import { BoardTargetingEditor } from "@/components/dashboard/board-targeting-editor";
import { listConnectedBoards } from "@/components/dashboard/board-credentials-data";
import { BOARD_LABELS } from "@/components/dashboard/labels";
import { getEEstekhdamCatalog } from "@/lib/apply/boards/eestekhdam-catalog";
import { getIranTalentCatalog } from "@/lib/apply/boards/irantalent-catalog";
import { getJobinjaCategories } from "@/lib/apply/boards/jobinja-categories";
import { getJobvisionCatalog } from "@/lib/apply/boards/jobvision-catalog";
import { readApplyFilters } from "@/lib/apply/filters";

interface CatalogRow { key: string; label: string; englishLabel?: string }

const ACTIVE_APPLY_BOARDS = ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const;
const JOBINJA_EMPLOYMENT_TYPES = [
  { key: "is_fulltime", label: "تمام‌وقت" },
  { key: "is_parttime", label: "پاره‌وقت" },
];

function toCatalog(c: { categories: CatalogRow[]; employmentTypes: CatalogRow[] }) {
  const map = (rows: CatalogRow[]) =>
    rows.map((row) => ({ key: row.key, label: row.label, englishLabel: row.englishLabel }));
  return { categories: map(c.categories), employmentTypes: map(c.employmentTypes) };
}

export async function ProviderTargetingSection({ userId }: { userId: string }) {
  const empty = { categories: [], employmentTypes: [] };
  const [filters, accounts, jobinja, jobvision, eestekhdam, irantalent] = await Promise.all([
    readApplyFilters(userId),
    listConnectedBoards(userId),
    getJobinjaCategories()
      .then((result) => ({
        categories: result.categories.map((category) => ({
          key: category.slug,
          label: category.name,
          englishLabel: category.englishName,
        })),
        employmentTypes: JOBINJA_EMPLOYMENT_TYPES,
      }))
      .catch(() => empty),
    getJobvisionCatalog().then(toCatalog).catch(() => empty),
    getEEstekhdamCatalog().then(toCatalog).catch(() => empty),
    getIranTalentCatalog().then(toCatalog).catch(() => empty),
  ]);

  return (
    <BoardTargetingEditor
      boards={[...ACTIVE_APPLY_BOARDS]}
      labels={BOARD_LABELS}
      connected={accounts}
      catalogs={{ jobinja, jobvision, "e-estekhdam": eestekhdam, irantalent }}
      initial={filters.boardFilters as never}
      globals={{
        paused: filters.paused,
        ...(filters.dailyLimit === undefined ? {} : { dailyLimit: filters.dailyLimit }),
        maxAgeDays: filters.maxAgeDays,
      }}
    />
  );
}
