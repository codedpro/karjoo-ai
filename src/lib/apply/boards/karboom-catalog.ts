import "server-only";


/**
 * کاتالوگِ فیلترهای کاربوم.
 *
 * کاربوم سمتِ سرور رندر می‌شود و فیلترهایش «مسیر» هستند، نه پارامتر: هر دسته یک
 * نشانی است (`/jobs/programming-and-software`). همه‌ی گزینه‌ها — دسته، شهر و نوعِ
 * همکاری — در یک جعبه‌ی واحد کنارِ هم می‌آیند و از روی نشانی از هم قابلِ تفکیک
 * نیستند، پس شهرها و نوع‌های همکاری (که کوچک و پایدارند) این‌جا صریح فهرست شده‌اند و
 * هرچه بماند «دسته» است. با این کار، دسته‌ی تازه‌ی کاربوم خودبه‌خود ظاهر می‌شود.
 */
const ORIGIN = "https://karboom.io";
const JOBS_URL = `${ORIGIN}/jobs`;

/** نوعِ همکاری — همان مسیرهایی که خودِ کاربوم استفاده می‌کند. */
const EMPLOYMENT_SLUGS = new Set([
  "full-time", "part-time", "project", "consultation", "intern", "remote",
]);

/** شهرها؛ در همان فهرست می‌آیند ولی دسته‌ی شغلی نیستند. */
const CITY_SLUGS = new Set([
  "tehran", "mashhad", "isfahan", "karaj", "shiraz", "ahvaz", "qazvin", "tabriz",
  "saveh", "alborz", "rasht", "hashtgerd", "amol", "babol", "kamalshahr",
  "buin-zahra", "pardis", "marvdasht", "yazd", "pakdasht", "kahrizak", "kerman",
  "kordan", "varamin", "sari", "arak", "robat-karim", "shahriar", "gorgan",
]);

export interface KarboomCatalogOption {
  key: string;
  label: string;
  englishLabel: string;
}

export interface KarboomCatalog {
  board: "karboom";
  categories: KarboomCatalogOption[];
  employmentTypes: KarboomCatalogOption[];
  cities: KarboomCatalogOption[];
}

/** برچسب‌های کاربوم با «استخدام » شروع می‌شوند؛ برای UI حذفش می‌کنیم. */
function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/^استخدام\s+/, "");
}

/**
 * شهرها از خودِ فرمِ جست‌وجو خوانده می‌شوند، چون آن‌جا شناسه‌ی عددی دارند و
 * `address_city_id[]` تنها فیلترِ واقعیِ کاربوم است که روی مسیرِ دسته هم سوار می‌شود.
 */
function parseCities(html: string): KarboomCatalogOption[] {
  const start = html.indexOf("js-select-city");
  if (start < 0) return [];
  const select = html.slice(start, html.indexOf("</select>", start));
  const cities: KarboomCatalogOption[] = [];
  const option = /<option value="(\d+)"[^>]*>\s*([^<]+?)\s*<\/option>/g;
  for (let m = option.exec(select); m; m = option.exec(select)) {
    const key = m[1]!;
    if (key === "-1") continue;
    cities.push({ key, label: m[2]!.trim(), englishLabel: key });
  }
  return cities;
}

/** PURE: صفحه‌ی /jobs → کاتالوگ. */
export function parseKarboomCatalog(html: string): KarboomCatalog {
  const start = html.indexOf("job-categories-box");
  const stop = html.indexOf("job-position-cards-box", start < 0 ? 0 : start);
  const box = html.slice(start < 0 ? 0 : start, stop > 0 ? stop : undefined);

  const seen = new Set<string>();
  const categories: KarboomCatalogOption[] = [];
  const employmentTypes: KarboomCatalogOption[] = [];
  const link = /href="https:\/\/karboom\.io\/jobs\/([a-z0-9-]{3,60})"[^>]*>\s*([^<]{2,80})/g;
  for (let m = link.exec(box); m; m = link.exec(box)) {
    const key = m[1]!;
    if (seen.has(key)) continue;
    seen.add(key);
    const option = { key, label: cleanLabel(m[2]!), englishLabel: key.replace(/-/g, " ") };
    if (!option.label) continue;
    if (EMPLOYMENT_SLUGS.has(key)) employmentTypes.push(option);
    else if (!CITY_SLUGS.has(key)) categories.push(option);
  }
  return { board: "karboom", categories, employmentTypes, cities: parseCities(html) };
}

export async function getKarboomCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<KarboomCatalog> {
  const response = await fetchImpl(JOBS_URL, {
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0 Karjoo/1.0" },
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`Karboom catalog failed (${response.status})`);
  const catalog = parseKarboomCatalog(await response.text());
  if (catalog.categories.length === 0) throw new Error("Karboom catalog returned no categories");
  return catalog;
}
