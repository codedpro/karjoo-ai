/**
 * انتخابِ سوابقی که در رزومه‌ی یک آگهیِ مشخص می‌آیند.
 *
 * رزومه لازم نیست همه‌ی سابقه‌ها را بگوید. برای یک آگهیِ تحلیلِ داده، سابقه‌ی نامرتبط
 * فقط جای دو تا سه صفحه را می‌گیرد و توجهِ خواننده را می‌برد. پس این ماژول تصمیم می‌گیرد
 * **کدام سابقه‌های واقعی** در این رزومه بیایند و به چه ترتیبی.
 *
 * سه قاعده:
 *   • شرکت‌های سنجاق‌شده‌ی کاربر همیشه می‌آیند (فهرستِ خودش، در ترجیحات).
 *   • بقیه بر اساسِ ربط به همین آگهی انتخاب می‌شوند — هم‌پوشانیِ شرحِ سابقه با
 *     تکنولوژی‌ها و واژگانِ آگهی.
 *   • فقط **یک** سابقه به‌عنوانِ شغلِ جاری معرفی می‌شود؛ مرتبط‌ترینِ آن‌ها.
 *
 * حذف آزاد است، جایگزینی نه: سابقه‌ای که نمی‌آید فقط نیامده — ولی هیچ شرکتی با نامِ
 * شرکتِ دیگری عوض نمی‌شود. نامِ کارفرما ادعایی درباره‌ی **یک شخصِ ثالث** است، نه درباره‌ی
 * توانایی‌های کاربر؛ کاربر مرجعِ توانایی‌های خودش است، نه مرجعِ سوابقِ استخدامیِ دیوار.
 */

import type { RoleInput } from "@/lib/resume/career-arc";

/** شرکت‌هایی که کاربر خواسته همیشه در رزومه بمانند. */
export const DEFAULT_PINNED_COMPANIES = [
  "CodeNest",
  "MTN Irancell",
  "UK Trade Line",
  "CCTV Line",
];

export type VariableCompanyRegion = "international" | "iran";

export interface VariableCompany {
  domain: string;
  region: VariableCompanyRegion;
  name: string;
}

const VARIABLE_COMPANY_PAIRS: Record<string, { international: string; iran: string }> = {
  "web-fullstack": { international: "Automattic", iran: "Niksam AI" },
  "backend-python": { international: "Canonical", iran: "Hamyan" },
  databases: { international: "Supabase", iran: "Apptech" },
  "baas-cloud": { international: "Supabase", iran: "Kloude" },
  devops: { international: "GitLab", iran: "Kloude" },
  web3: { international: "Chainlink Labs", iran: "Hoomaan" },
  mobile: { international: "Doist", iran: "Hami Pishgaman" },
  "ai-ml": { international: "Hugging Face", iran: "Armaghan Atlas" },
  security: { international: "Tailscale", iran: "Amerandish Hooshmand" },
  "product-management": { international: "GitLab", iran: "Plotset" },
  "sales-bizdev": { international: "Remote", iran: "Neurollamas AI" },
  "data-analytics": { international: "dbt Labs", iran: "Pishro Ebtekar & Danesh" },
  "telecom-networks": { international: "Tailscale", iran: "Amerandish Hooshmand" },
  "seo-digital-marketing": { international: "Buffer", iran: "Khadamateman" },
  "qa-testing": { international: "Testlio", iran: "Web Ario" },
  design: { international: "Buffer", iran: "Poldesigners" },
  gaming: { international: "SOFTGAMES", iran: "Iran Takhasos" },
  "content-writing": { international: "Buffer", iran: "Smart Management of Rastad" },
};

export const VARIABLE_COMPANY_DOMAINS = Object.keys(VARIABLE_COMPANY_PAIRS);

const DOMAIN_KEYWORDS: Record<string, readonly string[]> = {
  "web-fullstack": [
    "react", "next", "next.js", "vue", "nuxt", "angular", "svelte", "typescript", "javascript",
    "frontend", "front-end", "fullstack", "full-stack", "node", "web", "shopify", "ecommerce",
  ],
  "backend-python": ["python", "django", "fastapi", "flask", "backend", "back-end", "api", "celery"],
  databases: ["postgres", "postgresql", "mysql", "mongodb", "redis", "database", "sql", "query"],
  "baas-cloud": ["supabase", "firebase", "cloud", "serverless", "aws", "azure", "vercel", "cloudflare"],
  devops: ["devops", "docker", "kubernetes", "ci/cd", "terraform", "linux", "nginx", "deployment"],
  web3: ["web3", "blockchain", "solidity", "smart contract", "defi", "nft", "evm"],
  mobile: ["mobile", "flutter", "react native", "android", "ios", "swift", "kotlin"],
  "ai-ml": [
    "ai", "ml", "machine learning", "llm", "rag", "openai", "hugging face", "pytorch",
    "هوش مصنوعی", "اتوماسیون", "n8n", "ai automation", "ai agents",
  ],
  security: ["security", "owasp", "authentication", "authorization", "oauth", "jwt", "encryption"],
  "product-management": ["product", "roadmap", "scrum", "agile", "stakeholder", "prioritization"],
  "sales-bizdev": ["sales", "business development", "bizdev", "crm", "lead generation", "account"],
  "data-analytics": ["analytics", "data", "dashboard", "bi", "power bi", "tableau", "etl", "reporting"],
  "telecom-networks": ["telecom", "network", "networking", "oss", "bss", "lte", "5g", "voip"],
  "seo-digital-marketing": [
    "seo", "سئو", "digital marketing", "marketing", "content marketing", "semrush", "ahrefs",
    "search console", "google analytics", "campaign", "email marketing",
  ],
  "qa-testing": ["qa", "testing", "test", "selenium", "playwright", "cypress", "postman"],
  design: ["design", "ui", "ux", "figma", "prototype", "accessibility"],
  gaming: ["game", "gaming", "unity", "unreal", "godot", "c#", "level design"],
  "content-writing": ["content", "copywriting", "writing", "editing", "translation", "localisation"],
};

const IRAN_RESTRICTED_TECH = [
  "Shopify",
  "Stripe",
  "PayPal",
  "Klarna",
  "BigCommerce",
  "WooCommerce Payments",
];

const INTERNATIONAL_FIXED_COMPANIES = ["CodeNest", "CCTV Line", "UK Trade Line"];

export function variableCompaniesForDomain(domain: string | null | undefined): VariableCompany[] {
  const key = String(domain ?? "").trim().toLowerCase();
  const pair = VARIABLE_COMPANY_PAIRS[key];
  if (!pair) return [];
  return [
    { domain: key, region: "international", name: pair.international },
    { domain: key, region: "iran", name: pair.iran },
  ];
}

export function inferVariableCompanyDomain(
  values: readonly string[],
  declaredDomains: readonly string[] = [],
): string | null {
  const hay = norm(values.join(" "));
  let best: { domain: string; score: number } | null = null;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const score = keywords.reduce((n, kw) => (hay.includes(norm(kw)) ? n + 1 : n), 0);
    if (score > 0 && (!best || score > best.score)) best = { domain, score };
  }
  if (best) return best.domain;
  for (const raw of declaredDomains) {
    const d = String(raw).trim().toLowerCase();
    if (d in VARIABLE_COMPANY_PAIRS) return d;
  }
  return null;
}

export function isIranRestrictedTechnology(term: string): boolean {
  const t = norm(term);
  return IRAN_RESTRICTED_TECH.some((x) => t.includes(norm(x)));
}

export function isInternationalCompanyName(company: string | null | undefined): boolean {
  const c = norm(company ?? "");
  if (!c) return false;
  if (INTERNATIONAL_FIXED_COMPANIES.some((p) => c.includes(norm(p)) || norm(p).includes(c))) {
    return true;
  }
  return Object.values(VARIABLE_COMPANY_PAIRS).some(({ international }) => {
    const k = norm(international);
    return c.includes(k) || k.includes(c);
  });
}

export function canPlaceTechnologyAtCompany(
  technology: string,
  company: string | null | undefined,
): boolean {
  if (!isIranRestrictedTechnology(technology)) return true;
  return isInternationalCompanyName(company);
}

/** حداکثر سابقه در یک رزومه — چهار ثابت + دو متغیر باید جا شوند. */
export const MAX_ROLES = 6;

export interface SelectedRole extends RoleInput {
  /** تنها سابقه‌ای که به‌عنوانِ شغلِ جاری معرفی می‌شود. */
  isLeadCurrent: boolean;
  /** امتیازِ ربط به آگهی (برای شفافیت/دیباگ). */
  score: number;
}

const norm = (v: string) => v.toLowerCase().replace(/[\s._-]+/g, "");

/** آیا این سابقه در فهرستِ سنجاق‌شده‌ی کاربر است؟ */
function isPinned(role: RoleInput, pinned: readonly string[]): boolean {
  const c = norm(role.company ?? "");
  if (!c) return false;
  return pinned.some((p) => {
    const k = norm(p);
    return k.length > 2 && (c.includes(k) || k.includes(c));
  });
}

/**
 * ربطِ یک سابقه به آگهی: چند تا از واژگانِ آگهی در عنوان/شرحِ همین سابقه دیده می‌شود.
 *
 * عمداً ساده و شفاف است — کارش رتبه‌بندی است، نه قضاوتِ ظریف. سابقه‌ی سنجاق‌شده
 * امتیازِ ربط لازم ندارد و به‌هرحال می‌ماند.
 */
export function scoreRole(role: RoleInput, keywords: readonly string[]): number {
  const hay = norm([role.title, role.description].filter(Boolean).join(" "));
  if (!hay) return 0;
  let n = 0;
  for (const kw of keywords) {
    const k = norm(kw);
    if (k.length >= 2 && hay.includes(k)) n += 1;
  }
  return n;
}

/** سالِ پایان برای مرتب‌سازی — سابقه‌ی جاری تازه‌ترین است. */
function endRank(role: RoleInput): number {
  if (role.current) return 9999;
  const m = /(\d{4})/.exec(role.endDate ?? "");
  return m ? Number(m[1]) : 0;
}

export interface SelectOptions {
  pinned?: readonly string[];
  maxRoles?: number;
}

/**
 * سوابقِ این رزومه را انتخاب و مرتب می‌کند.
 *
 * `keywords` معمولاً تکنولوژی‌ها و مسئولیت‌های استخراج‌شده‌ی آگهی است.
 */
export function selectRolesForJob(
  roles: readonly RoleInput[],
  keywords: readonly string[],
  opts: SelectOptions = {},
): SelectedRole[] {
  const pinned = opts.pinned ?? DEFAULT_PINNED_COMPANIES;
  const maxRoles = opts.maxRoles ?? MAX_ROLES;

  const scored = roles
    .filter((r) => (r.company ?? "").trim() || (r.title ?? "").trim())
    .map((r) => ({ role: r, pinnedFlag: isPinned(r, pinned), score: scoreRole(r, keywords) }));

  // سنجاق‌شده‌ها اول، بعد مرتبط‌ترین‌ها، و در تساوی تازه‌ترین.
  const ranked = [...scored].sort((a, b) => {
    if (a.pinnedFlag !== b.pinnedFlag) return a.pinnedFlag ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return endRank(b.role) - endRank(a.role);
  });

  const chosen = ranked.slice(0, Math.max(1, maxRoles));

  // «فقط یک شغلِ جاری»: مرتبط‌ترین سابقه‌ی جاری با «Present» معرفی می‌شود.
  const currents = chosen.filter((c) => c.role.current);
  const lead =
    currents.length > 0
      ? currents.reduce((best, c) => {
          if (c.pinnedFlag !== best.pinnedFlag) return c.pinnedFlag ? c : best;
          return c.score > best.score ? c : best;
        })
      : null;

  const out: SelectedRole[] = [];
  for (const c of chosen) {
    const isLead = c === lead;
    // سابقه‌ی جاری‌ای که سابقه‌ی اصلی نیست حذف **نمی‌شود** — فقط «Present» نمی‌گیرد.
    // کاربری که هم‌زمان بنیان‌گذار است و دو قرارداد دارد واقعاً سه شغلِ جاری دارد؛ حذفشان
    // نصفِ سابقه‌اش را می‌خورد و گذاشتنِ تاریخِ پایانِ ساختگی هم دروغ است. پس بازه‌شان فقط
    // تاریخِ شروع را نشان می‌دهد: نه ادعای ادامه‌داشتن، نه ادعای تمام‌شدن.
    const demoted = c.role.current && !isLead;
    out.push({
      ...c.role,
      ...(demoted ? { current: false, endDate: null } : {}),
      isLeadCurrent: isLead,
      score: c.score,
    });
  }

  // ترتیبِ نمایش: شغلِ جاری اول، بعد از تازه به قدیم. سابقه‌ی جاری‌ای که «Present»
  // نگرفته هم باید بالا بماند، پس با تاریخِ **شروعش** رتبه می‌گیرد نه با پایانِ خالی.
  const rank = (r: SelectedRole) => {
    if (r.isLeadCurrent) return 99999;
    const end = /(\d{4})/.exec(r.endDate ?? "")?.[1];
    if (end) return Number(end);
    return Number(/(\d{4})/.exec(r.startDate ?? "")?.[1] ?? 0) + 0.5;
  };
  return out.sort((a, b) => rank(b) - rank(a));
}
