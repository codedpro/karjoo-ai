import "server-only";

const FILTERS_URL = "https://www.e-estekhdam.com/search-api/search/filter-options";

export interface EEstekhdamCatalogOption {
  key: string;
  label: string;
  englishLabel: string;
}

export interface EEstekhdamCatalog {
  board: "e-estekhdam";
  categories: EEstekhdamCatalogOption[];
  employmentTypes: EEstekhdamCatalogOption[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function valueOf(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function option(value: unknown): EEstekhdamCatalogOption | null {
  const row = record(value);
  const key = valueOf(row, "key", "slug", "value");
  const label = valueOf(row, "title", "label", "name", "key") || key;
  const englishLabel = valueOf(row, "englishTitle", "englishLabel", "titleEn");
  return key && label ? { key, label, englishLabel } : null;
}

function flattenPositions(value: unknown): EEstekhdamCatalogOption[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, EEstekhdamCatalogOption>();
  for (const group of value) {
    const items = record(group).items;
    const leaves = Array.isArray(items) && items.length > 0 ? items : [group];
    for (const leaf of leaves) {
      const item = option(leaf);
      if (item) found.set(item.key, item);
    }
  }
  return [...found.values()];
}

function contractOptions(value: unknown): EEstekhdamCatalogOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const item = option(row);
    return item ? [item] : [];
  });
}

export async function getEEstekhdamCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<EEstekhdamCatalog> {
  const response = await fetchImpl(FILTERS_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 Karjoo/1.0",
    },
    body: JSON.stringify({ version: null, keys: [] }),
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`e-estekhdam catalog failed (${response.status})`);
  const payload = await response.json() as { data?: Record<string, unknown> };
  const data = record(payload.data);
  return {
    board: "e-estekhdam",
    categories: flattenPositions(data.positions),
    employmentTypes: contractOptions(data.contracts),
  };
}
