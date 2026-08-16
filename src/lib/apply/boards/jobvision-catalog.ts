import "server-only";

const FILTERS_URL = "https://candidateapi.jobvision.ir/api/v1/JobPost/GetAllSearchFilters";

export interface BoardCatalogOption {
  key: string;
  label: string;
  englishLabel: string;
}

export interface BoardCatalog {
  board: "jobvision";
  categories: BoardCatalogOption[];
  employmentTypes: BoardCatalogOption[];
}

function options(value: unknown, keyField: "urlTitle" | "urlParameter"): BoardCatalogOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const key = typeof row[keyField] === "string" ? row[keyField].trim() : "";
    const label = typeof row.titleFa === "string" ? row.titleFa.trim() : "";
    const englishLabel = typeof row.titleEn === "string" ? row.titleEn.trim() : "";
    return key && label ? [{ key, label, englishLabel }] : [];
  });
}

export async function getJobvisionCatalog(fetchImpl: typeof fetch = fetch): Promise<BoardCatalog> {
  const response = await fetchImpl(FILTERS_URL, {
    headers: { accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`JobVision catalog failed (${response.status})`);
  const body = await response.json() as { data?: Record<string, unknown> };
  return {
    board: "jobvision",
    categories: options(body.data?.jobCategories, "urlTitle"),
    employmentTypes: options(body.data?.workTypes, "urlParameter"),
  };
}
