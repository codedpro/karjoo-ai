import "server-only";

/**
 * پشتیبانیِ robots.txt برای برداشتِ مودبانه (بخش ۱۰ سند معماری، قاعده‌ی ۳ CONTEXT).
 *
 * قبل از خواندنِ هر صفحه‌ی عمومی، باید robots.txtِ همان host را احترام بگذاریم،
 * با rate-limitِ مودبانه و یک User-Agentِ قابل‌شناسایی. این ماژول سه کار می‌کند:
 *   1) robots.txtِ یک host را fetch می‌کند (با fetchِ قابل‌تزریق برای تست).
 *   2) آن را به قواعدِ Allow/Disallow برای هر user-agent پارس می‌کند.
 *   3) `isAllowed(url, userAgent)` را بر اساسِ خاص‌ترین قاعده‌ی منطبق برمی‌گرداند.
 *
 * قواعدِ منطبق با استانداردِ عملیِ robots:
 *   • تطبیقِ گروهِ user-agent: خاص‌ترین (طولانی‌ترین) پیشوندِ نامِ UA که در فایل آمده،
 *     وگرنه گروهِ `*`.
 *   • تطبیقِ مسیر: خاص‌ترین (طولانی‌ترین) الگوی منطبق برنده است؛ در تساوی، Allow بر
 *     Disallow اولویت دارد. الگوها از `*` (هرچیز) و `$` (انتهای مسیر) پشتیبانی می‌کنند.
 *   • `Disallow:` خالی = اجازه‌ی همه‌چیز.
 *   • نبودِ robots.txt یا خطای شبکه/۴۰۴ = اجازه‌ی همه‌چیز (fail-open مودبانه؛ استانداردِ رایج).
 */

/**
 * User-Agentِ قابل‌شناساییِ کارجو. برای سازگاری با سایت‌هایی که به UAِ مرورگری حساس‌اند
 * یک رشته‌ی مرورگرمانند است، اما توکنِ شناسه‌ی ربات (`KarjooBot`) را هم دارد تا هم در
 * هدرِ درخواست و هم در تطبیقِ robots از همین رشته‌ی واحد استفاده شود (CONTEXT: «UA را
 * نمایان کن تا robots با همان رشته بررسی شود»).
 */
export const KARJOO_USER_AGENT =
  "Mozilla/5.0 (compatible; KarjooBot/1.0; +https://karjoo.ai/bot) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** توکنِ کوتاهِ نامِ ربات — همانی که در گروه‌های `User-agent:` robots دنبالش می‌گردیم. */
export const KARJOO_UA_TOKEN = "karjoobot";

/** یک قاعده‌ی منفرد: نوع (allow/disallow) + الگوی مسیر. */
interface RobotRule {
  type: "allow" | "disallow";
  /** الگوی خامِ مسیر (مثل `/jobs` یا `/private/*` یا `/x$`). */
  pattern: string;
}

/** قواعدِ پارس‌شده‌ی یک host، گروه‌بندی‌شده بر اساسِ نامِ user-agent (lowercase). */
export interface ParsedRobots {
  /** نگاشتِ نامِ UA (lowercase) → فهرستِ قواعدِ آن گروه. کلیدِ `*` گروهِ پیش‌فرض است. */
  groups: Map<string, RobotRule[]>;
}

/* ────────────────────────────────  پارس  ───────────────────────────────── */

/**
 * متنِ robots.txt را به `ParsedRobots` تبدیل می‌کند. خطوطِ کامنت/خالی نادیده گرفته
 * می‌شوند. چند `User-agent:` پشتِ‌سرِهم یک گروهِ مشترک می‌سازند (تا اولین directive).
 */
export function parseRobotsTxt(text: string): ParsedRobots {
  const groups = new Map<string, RobotRule[]>();
  let currentAgents: string[] = [];
  // آیا از آخرین User-agent، هنوز directiveی ندیده‌ایم؟ (برای گروه‌بندیِ چند UA).
  let expectingAgentGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    // کامنت‌ها را حذف کن، فاصله‌ها را trim.
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // اگر بعد از directiveها دوباره User-agent دیدیم، گروهِ تازه شروع می‌شود.
      if (!expectingAgentGroup) {
        currentAgents = [];
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) {
        groups.set(value.toLowerCase(), []);
      }
      expectingAgentGroup = true;
      continue;
    }

    if (field === "allow" || field === "disallow") {
      expectingAgentGroup = false;
      // directive بدونِ گروهِ user-agent → بی‌معنا، رد شو.
      if (currentAgents.length === 0) continue;
      const rule: RobotRule = { type: field, pattern: value };
      for (const agent of currentAgents) {
        groups.get(agent)!.push(rule);
      }
      continue;
    }

    // سایرِ directiveها (Sitemap, Crawl-delay, …) را اینجا نادیده می‌گیریم.
    expectingAgentGroup = false;
  }

  return { groups };
}

/* ─────────────────────────────  تطبیقِ مسیر  ────────────────────────────── */

/**
 * بررسی می‌کند که آیا الگوی robots با مسیرِ داده‌شده منطبق است. از `*` (هر دنباله) و
 * `$` (انتهای مسیر) پشتیبانی می‌کند. تطبیق «پیشوندی» است مگر `$` در انتها بیاید.
 */
export function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === "") return false; // الگوی خالی هیچ‌چیز را disallow نمی‌کند.
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;

  // الگو را به regex تبدیل کن: `*` → `.*`، بقیه escape شود.
  let re = "^";
  for (const ch of body) {
    if (ch === "*") {
      re += ".*";
    } else {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += anchoredEnd ? "$" : "";
  return new RegExp(re).test(path);
}

/**
 * خاص‌ترین گروهِ user-agent منطبق را برمی‌گرداند: طولانی‌ترین نامِ UA در فایل که
 * توکنش در رشته‌ی UAِ ما باشد؛ وگرنه گروهِ `*`؛ وگرنه آرایه‌ی خالی.
 */
function selectGroup(parsed: ParsedRobots, userAgent: string): RobotRule[] {
  const uaLower = userAgent.toLowerCase();
  let best: { name: string; rules: RobotRule[] } | null = null;
  for (const [name, rules] of parsed.groups) {
    if (name === "*") continue;
    // نامِ گروهِ robots باید زیررشته‌ای از UAِ ما باشد (تطبیقِ توکنِ ربات).
    if (uaLower.includes(name) && (!best || name.length > best.name.length)) {
      best = { name, rules };
    }
  }
  if (best) return best.rules;
  return parsed.groups.get("*") ?? [];
}

/**
 * بر اساسِ قواعدِ پارس‌شده تصمیم می‌گیرد که آیا مسیر برای این UA مجاز است.
 * خاص‌ترین (طولانی‌ترین الگوی) قاعده‌ی منطبق برنده است؛ در تساوی، allow بر disallow.
 * نبودِ قاعده‌ی منطبق = مجاز.
 */
export function isPathAllowed(
  parsed: ParsedRobots,
  path: string,
  userAgent: string = KARJOO_USER_AGENT,
): boolean {
  const rules = selectGroup(parsed, userAgent);

  let decision: "allow" | "disallow" | null = null;
  let bestLen = -1;

  for (const rule of rules) {
    if (rule.type === "disallow" && rule.pattern === "") {
      // `Disallow:` خالی = اجازه‌ی همه‌چیز؛ ضعیف‌ترین قاعده (طول ۰، فقط اگر چیزی نبود).
      continue;
    }
    if (!matchesPattern(rule.pattern, path)) continue;

    const len = rule.pattern.length;
    if (len > bestLen) {
      bestLen = len;
      decision = rule.type;
    } else if (len === bestLen && rule.type === "allow") {
      // تساویِ طول → allow بر disallow اولویت دارد.
      decision = "allow";
    }
  }

  if (decision === null) return true; // هیچ قاعده‌ای منطبق نشد → مجاز.
  return decision === "allow";
}

/* ──────────────────────────  fetch + cache (host)  ──────────────────────── */

/** ورودیِ کشِ یک host: قواعدِ پارس‌شده + زمانِ واکشی (برای TTL). */
interface CacheEntry {
  parsed: ParsedRobots;
  fetchedAtMs: number;
}

/** TTLِ پیش‌فرضِ کش (۱ ساعت) — robots.txt به‌ندرت عوض می‌شود. */
export const ROBOTS_CACHE_TTL_MS = 60 * 60_000;

/** کشِ درون‌حافظه‌ایِ سطحِ ماژول، کلید بر اساسِ origin (scheme://host:port). */
const cache = new Map<string, CacheEntry>();

/** آپشن‌های قابل‌تزریقِ بررسیِ robots. */
export interface RobotsOptions {
  /** override fetch (تست/شبکه‌ی شبیه‌سازی). پیش‌فرض: fetch سراسری. */
  fetchImpl?: typeof fetch;
  /** override ساعت (تست TTL). پیش‌فرض: Date.now. */
  now?: () => number;
  /** UAِ بررسی‌شونده. پیش‌فرض: KARJOO_USER_AGENT (همان UAِ درخواست‌ها). */
  userAgent?: string;
  /** نادیده‌گرفتنِ کش و واکشیِ تازه. */
  forceRefresh?: boolean;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** کشِ robots را خالی می‌کند (برای تستِ ایزوله). */
export function clearRobotsCache(): void {
  cache.clear();
}

/**
 * robots.txtِ یک origin را (با کش) واکشی و پارس می‌کند.
 *   • ۲xx → پارس و کش.
 *   • ۴۲۹/۵xx («در دسترس نیست»، RFC 9309 §2.3.1.4) → disallow-all و *بدونِ* کش
 *     (تا بلوکِ گذرا دفعه‌ی بعد دوباره امتحان شود؛ مودبانه عقب می‌کشیم).
 *   • ۴۰۳/۴۰۴/۴۱۰ یا خطای شبکه/timeout → اجازه‌ی همه‌چیز (fail-open مودبانه) و کش.
 */
export async function getRobotsFor(
  origin: string,
  opts: RobotsOptions = {},
): Promise<ParsedRobots> {
  const now = opts.now ?? (() => Date.now());
  const fetchImpl = opts.fetchImpl ?? fetch;

  const cached = cache.get(origin);
  if (cached && !opts.forceRefresh && now() - cached.fetchedAtMs < ROBOTS_CACHE_TTL_MS) {
    return cached.parsed;
  }

  let parsed: ParsedRobots;
  // در حالتِ «در دسترس نیست» (۴۲۹/۵xx) کش نمی‌کنیم تا بلوکِ گذرا دفعه‌ی بعد دوباره
  // امتحان شود (نه اینکه یک ساعت روی disallow-all قفل بمانیم).
  let cacheable = true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, {
        method: "GET",
        headers: { "User-Agent": opts.userAgent ?? KARJOO_USER_AGENT },
        signal: controller.signal,
        redirect: "follow",
      });
      if (res.ok) {
        // robots.txt موجود → پارس کن.
        parsed = parseRobotsTxt(await res.text());
      } else if (res.status === 429 || res.status >= 500) {
        // «در دسترس نیست» طبق RFC 9309 §2.3.1.4: ۴۲۹ (Too Many Requests) یا ۵xx
        // ⇒ همه‌چیز ممنوع (سایت دارد throttle/خطا می‌دهد؛ مودبانه عقب بکش). کش نکن.
        parsed = { groups: new Map([["*", [{ type: "disallow", pattern: "/" }]]]) };
        cacheable = false;
      } else {
        // ۴۰۳/۴۰۴/۴۱۰ … → فایلِ robots وجود ندارد ⇒ اجازه‌ی همه‌چیز.
        parsed = { groups: new Map() };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // خطای شبکه/timeout → fail-open (اجازه)، ولی کش کن تا اسپم نشود.
    parsed = { groups: new Map() };
  }

  if (cacheable) cache.set(origin, { parsed, fetchedAtMs: now() });
  return parsed;
}

/**
 * آیا واکشیِ این URL برای UAِ ما طبق robots.txtِ همان host مجاز است؟
 * robots را (با کش) واکشی می‌کند و سپس مسیر را بررسی می‌کند. در هر خطا fail-open
 * (مجاز) است — اما این مسیر فقط برای خواندنِ آگهیِ عمومی استفاده می‌شود.
 */
export async function isAllowed(
  url: string,
  userAgent: string = KARJOO_USER_AGENT,
  opts: RobotsOptions = {},
): Promise<boolean> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false; // URLِ نامعتبر → خواندنش بی‌معنی است.
  }
  const parsed = await getRobotsFor(parsedUrl.origin, { ...opts, userAgent });
  const path = parsedUrl.pathname + parsedUrl.search;
  return isPathAllowed(parsed, path, userAgent);
}
