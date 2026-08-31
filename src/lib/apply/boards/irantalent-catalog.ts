import "server-only";

/**
 * IranTalent filter catalog.
 *
 * irantalent.com is a client-rendered Angular SPA — the jobs page ships no SSR
 * state — so the catalog comes from the same public lookup endpoint the site's
 * own bundle calls (`environment.http.base_url + /api/v1/`). Lookup rows are
 * typed; the two types the job-search filter uses are:
 *
 *   • type 42 → job-category filter groups (`job_category_ids` in the search body)
 *   • type 17 → employment types           (`employment_type_ids`)
 *
 * Keys are the numeric lookup ids because the search API filters by id, not by
 * slug; the extension passes them straight through to discovery.
 */
const LOOKUP_URL = "https://api.irantalent.com/api/v1/public-area/lookup/all?client_last_update=0";

/** Lookup type ids used by the IranTalent job-search filter. */
export const IRANTALENT_JOB_CATEGORY_LOOKUP_TYPE = "42";
export const IRANTALENT_EMPLOYMENT_TYPE_LOOKUP_TYPE = "17";

export interface IranTalentCatalogOption {
  key: string;
  label: string;
  englishLabel: string;
}

export interface IranTalentCatalog {
  board: "irantalent";
  categories: IranTalentCatalogOption[];
  employmentTypes: IranTalentCatalogOption[];
}

type LookupRow = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  title_farsi?: unknown;
};

function option(row: LookupRow): IranTalentCatalogOption | null {
  const key =
    typeof row.id === "number" || (typeof row.id === "string" && row.id.trim())
      ? String(row.id).trim()
      : "";
  const label = typeof row.title_farsi === "string" ? row.title_farsi.trim() : "";
  const englishLabel = typeof row.title === "string" ? row.title.trim() : "";
  return key && (label || englishLabel)
    ? { key, label: label || englishLabel, englishLabel }
    : null;
}

/** PURE: pick the two filter dimensions out of a lookup payload. */
export function parseIranTalentLookup(payload: unknown): IranTalentCatalog {
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rows = Array.isArray(body.data) ? body.data as LookupRow[] : [];
  const collect = (type: string) =>
    rows
      .flatMap((row) => {
        if (String(row.type ?? "") !== type) return [];
        const item = option(row);
        return item ? [item] : [];
      })
      .sort((a, b) => a.label.localeCompare(b.label, "fa"));
  return {
    board: "irantalent",
    categories: collect(IRANTALENT_JOB_CATEGORY_LOOKUP_TYPE),
    employmentTypes: collect(IRANTALENT_EMPLOYMENT_TYPE_LOOKUP_TYPE),
  };
}

export async function getIranTalentCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<IranTalentCatalog> {
  const response = await fetchImpl(LOOKUP_URL, {
    headers: { accept: "application/json" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`IranTalent catalog failed (${response.status})`);
  const catalog = parseIranTalentLookup(await response.json());
  if (catalog.categories.length === 0) throw new Error("IranTalent catalog returned no categories");
  return catalog;
}
