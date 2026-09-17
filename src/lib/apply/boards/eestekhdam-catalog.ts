import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const FILTERS_URL = "https://www.e-estekhdam.com/search-api/search/filter-options";

/**
 * e-estekhdam از این سرور گاهی اصلاً پاسخ نمی‌دهد. بدونِ این محافظ‌ها هر بازکردنِ صفحه‌ی
 * هدف‌گیری ۱۰ ثانیه منتظرِ timeout می‌ماند. پس: timeoutِ کوتاه، کشِ حافظه برای موفقیت و
 * شکست، آخرین فهرستِ سالم روی دیسک، و در نبودِ آن یک فهرستِ اولیه از کلیدهای واقعیِ سایت.
 */
const FETCH_TIMEOUT_MS = 4_000;
const SUCCESS_TTL_MS = 6 * 60 * 60_000;
const FAILURE_TTL_MS = 10 * 60_000;
const DISK_CACHE_PATH = join(process.cwd(), ".karjoo-runtime", "catalogs", "e-estekhdam.json");

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

/** کلیدهای واقعیِ سایت (همان‌هایی که کاربران ذخیره کرده‌اند)؛ برچسب = کلید بدونِ خط‌تیره. */
const FALLBACK_CATEGORY_KEYS = [
  "برنامه-نویس",
  "مهندس-کامپیوتر",
  "طراح-وب-سایت",
  "طراح-UI|UX",
  "وردپرس-کار",
  "مدیر-وب-سایت",
  "متخصص-SEO",
  "کارشناس-دیجیتال-مارکتینگ",
  "کارشناس-تولید-محتوا",
  "مسئول-تولید-محتوا",
  "کارشناس-امنیت-سایبری",
  "کارشناس-تست-نرم‌افزار",
  "کارشناس-تضمین-کیفیت",
  "متخصص-پایگاه-داده",
  "کارشناس-BI",
  "تحلیلگر-اطلاعات",
  "تحلیلگر-کسب-و-کار",
  "تحلیلگر-بازار",
  "تحلیلگر-بورس",
  "تکنسین-کامپیوتر",
  "مدرس-کامپیوتر",
  "مدیر-محصول",
  "مدیر-پروژه",
  "مدیر-پروژه-نرم-افزار",
  "مدیر-بازاریابی",
  "مدیر-تبلیغات",
  "مدیر-برنامه-ریزی",
  "مدیر-تضمین-کیفیت",
  "مدیر-کنترل-کیفی",
  "مدیر-کارخانه",
  "مدیر",
];
const FALLBACK_CONTRACT_KEYS = ["تمام-وقت", "دورکاری", "پروژه‌ای"];

function fallbackOption(key: string): EEstekhdamCatalogOption {
  return { key, label: key.replace(/-/g, " ").replace("|", "/"), englishLabel: "" };
}

export const FALLBACK_EESTEKHDAM_CATALOG: EEstekhdamCatalog = {
  board: "e-estekhdam",
  categories: FALLBACK_CATEGORY_KEYS.map(fallbackOption),
  employmentTypes: FALLBACK_CONTRACT_KEYS.map(fallbackOption),
};

let memory: { at: number; ok: boolean; value: EEstekhdamCatalog } | null = null;

async function readDiskCache(path: string): Promise<EEstekhdamCatalog | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as EEstekhdamCatalog;
    return parsed.categories?.length ? parsed : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(path: string, value: EEstekhdamCatalog): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, path);
  } catch {
    // کشِ دیسک فقط کمکی است؛ خطای نوشتن فهرست را از کاربر نمی‌گیرد.
  }
}

export interface EEstekhdamCatalogOptions {
  now?: () => number;
  diskPath?: string;
}

/**
 * فهرستِ زمینه‌ها و نوعِ همکاریِ e-estekhdam. هرگز throw نمی‌کند: در شکست، آخرین فهرستِ
 * سالم (دیسک) یا فهرستِ اولیه برمی‌گردد.
 */
export async function getEEstekhdamCatalog(
  fetchImpl: typeof fetch = fetch,
  opts: EEstekhdamCatalogOptions = {},
): Promise<EEstekhdamCatalog> {
  const now = opts.now?.() ?? Date.now();
  const diskPath = opts.diskPath ?? DISK_CACHE_PATH;
  if (memory && now - memory.at < (memory.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS)) {
    return memory.value;
  }
  try {
    const fresh = await fetchCatalog(fetchImpl);
    memory = { at: now, ok: true, value: fresh };
    await writeDiskCache(diskPath, fresh);
    return fresh;
  } catch {
    const value = (await readDiskCache(diskPath)) ?? FALLBACK_EESTEKHDAM_CATALOG;
    memory = { at: now, ok: false, value };
    return value;
  }
}

/** فقط برای تست. */
export function resetEEstekhdamCatalogCache(): void {
  memory = null;
}

async function fetchCatalog(fetchImpl: typeof fetch): Promise<EEstekhdamCatalog> {
  const response = await fetchImpl(FILTERS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
  const categories = flattenPositions(data.positions);
  if (categories.length === 0) throw new Error("e-estekhdam catalog was empty");
  return {
    board: "e-estekhdam",
    categories,
    employmentTypes: contractOptions(data.contracts),
  };
}
