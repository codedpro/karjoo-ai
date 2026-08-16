/**
 * قراردادِ فرمِ «فیلترهای اپلای» (Track A) — client-safe (بدونِ server-only, بدونِ I/O).
 *
 * این ماژول یک منبعِ حقیقتِ *مشترکِ سرور/کلاینت* برای پیکرِ فیلترهاست:
 *   • گزینه‌های ثابتِ UI (نوعِ همکاری، ترتیبِ نتایج) با برچسبِ فارسی و مقدارِ واقعیِ جابینجا،
 *   • اسکیمای zod برای اعتبارسنجیِ بدنه‌ی PUT /api/apply/filters،
 *   • یک سازنده‌ی «آینه‌ایِ» URLِ پیش‌نمایش برای بازخوردِ زنده در مرورگر.
 *
 * چرا آینه؟ سازنده‌ی canonical یعنی `buildSearchUrl` (src/lib/apply/boards/jobinja.ts)
 * در ماژولِ `server-only` است و نمی‌تواند به کلاینت بیاید. برای اینکه پیش‌نمایش هم‌زمان با
 * تیک‌زدنِ کاربر «زنده» به‌روز شود، همان قراردادِ پارامترهای جابینجا این‌جا آینه شده است.
 * ⚠️ اگر نام/ترتیبِ پارامترها در `buildSearchUrl` عوض شد، این آینه هم باید هم‌گام شود.
 *
 * مقادیرِ نوعِ همکاری و ترتیب از فرمِ زنده‌ی جابینجا استخراج شده‌اند:
 *   • job_types عمومی فقط دو گزینه دارد: `is_fulltime`, `is_parttime` (دورکاری فیلترِ جداست).
 *   • sort: `relevance_desc` | `published_at_desc` | `salary_from_desc`.
 */
import { z } from "zod";

/** میزبانِ جست‌وجوی جابینجا — پایه‌ی URLِ پیش‌نمایش (هم‌سو با buildSearchUrl). */
const JOBINJA_JOBS_URL = "https://jobinja.ir/jobs";

/* ───────────────────────────  گزینه‌های ثابتِ UI  ─────────────────────────── */

/** مقادیرِ مجازِ نوعِ همکاری (machine_nameِ جابینجا؛ از فرمِ زنده). */
export const JOB_TYPE_VALUES = ["is_fulltime", "is_parttime"] as const;
export type JobTypeValue = (typeof JOB_TYPE_VALUES)[number];

/** مقادیرِ مجازِ ترتیبِ نتایج (از select جابینجا). */
export const SORT_VALUES = [
  "relevance_desc",
  "published_at_desc",
  "salary_from_desc",
] as const;
export type SortValue = (typeof SORT_VALUES)[number];

/** ترتیبِ پیش‌فرضِ جابینجا وقتی کاربر انتخابی نکرده. */
export const DEFAULT_SORT: SortValue = "published_at_desc";

/** یک گزینه‌ی انتخابیِ ساده برای UI. */
export interface SelectOption<V extends string = string> {
  value: V;
  labelFa: string;
  hintFa?: string;
}

/** گزینه‌های نوعِ همکاری (چک‌باکس‌ها). */
export const JOB_TYPE_OPTIONS: SelectOption<JobTypeValue>[] = [
  { value: "is_fulltime", labelFa: "تمام‌وقت" },
  { value: "is_parttime", labelFa: "پاره‌وقت" },
];

/** گزینه‌های ترتیبِ نتایج (select). */
export const SORT_OPTIONS: SelectOption<SortValue>[] = [
  { value: "relevance_desc", labelFa: "مرتبط‌ترین", hintFa: "پیش‌فرضِ جابینجا" },
  { value: "published_at_desc", labelFa: "تازه‌ترین", hintFa: "به‌ترتیبِ زمانِ انتشار" },
  { value: "salary_from_desc", labelFa: "بیشترین حقوق", hintFa: "از بالاترین حقوق" },
];

/** یک دسته‌ی جابینجا آن‌گونه که UI لازم دارد (زیرمجموعه‌ی JobinjaCategory). */
export interface CategoryOption {
  /** machine_name — همان مقداری که در filters[job_categories][] می‌رود. */
  slug: string;
  /** نامِ فارسیِ نمایشی. */
  name: string;
  /** نامِ انگلیسی (برای جست‌وجوی لاتین؛ ممکن است خالی باشد). */
  englishName: string;
}

/* ─────────────────────────────  اسکیمای zod  ─────────────────────────────── */

/** یک slug/شهرِ تمیزِ غیرخالی با سقفِ طول (جلوگیری از بدنه‌ی غول‌آسا). */
const trimmedToken = (max: number) => z.string().trim().min(1).max(max);

const boardFilterInputSchema = z.object({
  enabled: z.boolean().default(false),
  categoryKeys: z.array(trimmedToken(160)).max(100).default([]),
  cities: z.array(trimmedToken(80)).max(50).default([]),
  employmentTypeKeys: z.array(trimmedToken(120)).max(30).default([]),
  remoteOnly: z.boolean().default(false),
  minSalary: z.number().int().nonnegative().max(1_000_000_000).optional(),
  sort: trimmedToken(80).optional(),
});

/**
 * بدنه‌ی PUT /api/apply/filters — جایگزینیِ کاملِ انتخاب‌های پیکر.
 *
 * امنیت (§10): عمداً `userId` و `aiFilterEnabled` نمی‌گیرد. کاربر از نشست گرفته می‌شود و
 * تاگلِ «فیلترِ هوشمند (AI)» مالِ مسیرِ گیت‌شده‌ی پریمیوم (Track C) است؛ این مسیر آن را
 * حفظ می‌کند نه بازنویسی. آرایه‌های خالی مجازند (یعنی «بدونِ فیلتر»).
 */
export const applyFiltersInputSchema = z.object({
  /** slugِ دسته‌های انتخابی (machine_nameِ جابینجا). حداکثر ۴۸ (کلِ تاکسونومی). */
  categorySlugs: z.array(trimmedToken(120)).max(48).default([]),
  /** شهرها (متنِ آزاد). */
  cities: z.array(trimmedToken(60)).max(30).default([]),
  /** نوعِ همکاری (فقط مقادیرِ شناخته‌شده). */
  jobTypes: z.array(z.enum(JOB_TYPE_VALUES)).max(JOB_TYPE_VALUES.length).default([]),
  /** فقط دورکاری. */
  remoteOnly: z.boolean().default(false),
  /** حداقلِ حقوق (تومان). ۰/نبود = بدونِ حداقل. */
  minSalary: z.number().int().nonnegative().max(1_000_000_000).optional(),
  /** ترتیبِ نتایج. نبود = پیش‌فرضِ جابینجا. */
  sort: z.enum(SORT_VALUES).optional(),
  /** توقفِ کشف/صف‌گذاری. */
  paused: z.boolean().default(false),
  /** سقفِ صف‌گذاری روزانه‌ی کاربر. */
  dailyLimit: z.number().int().positive().max(10_000).optional(),
  /** سقفِ صف‌گذاری هفتگیِ کاربر. */
  weeklyLimit: z.number().int().positive().max(100_000).optional(),
  maxAgeDays: z.number().int().min(1).max(45).default(45),
  boardFiltersVersion: z.literal(1).optional(),
  boardFilters: z.object({
    jobinja: boardFilterInputSchema,
    jobvision: boardFilterInputSchema,
  }).optional(),
});

/** ورودیِ اعتبارسنجی‌شده‌ی فرم (خروجیِ zod — آرایه‌ها همیشه حاضرند). */
export type ApplyFiltersInput = z.infer<typeof applyFiltersInputSchema>;

/* ────────────────────────  آینه‌ی URLِ پیش‌نمایش  ──────────────────────────── */

/** شکلِ سبکِ فیلترها که سازنده‌ی پیش‌نمایش لازم دارد (زیرمجموعه‌ی ApplyFilters). */
export interface PreviewFilters {
  categorySlugs: string[];
  cities: string[];
  jobTypes: string[];
  remoteOnly: boolean;
  minSalary?: number;
  sort?: string;
}

/**
 * URLِ جست‌وجوی جابینجا را از انتخاب‌های پیکر می‌سازد — *آینه‌ی* `buildSearchUrl` برای
 * پیش‌نمایشِ زنده در کلاینت. عمداً `titles` (کلیدواژه‌ی مشتق از علاقه‌مندی‌ها) را شامل
 * نمی‌شود تا پیش‌نمایش دقیقاً همان چیزی باشد که کاربر در پیکر می‌بیند.
 *
 * ترتیبِ append دقیقاً مطابقِ buildSearchUrl است تا رشته‌ی خروجی بیت‌به‌بیت یکی باشد:
 * locations → job_categories → job_types → remote → sal_min → sort.
 */
export function buildJobinjaPreviewUrl(filters: PreviewFilters): string {
  const url = new URL(JOBINJA_JOBS_URL);
  const params = url.searchParams;

  for (const city of filters.cities ?? []) {
    const c = city.trim();
    if (c) params.append("filters[locations][]", c);
  }
  for (const cat of filters.categorySlugs ?? []) {
    const s = cat.trim();
    if (s) params.append("filters[job_categories][]", s);
  }
  for (const jt of filters.jobTypes ?? []) {
    const t = jt.trim();
    if (t) params.append("filters[job_types][]", t);
  }
  if (filters.remoteOnly) params.set("filters[remote]", "1");
  if (typeof filters.minSalary === "number" && filters.minSalary > 0) {
    params.set("filters[sal_min]", String(filters.minSalary));
  }
  if (filters.sort && filters.sort.trim().length > 0) {
    params.set("sort", filters.sort.trim());
  } else {
    params.set("sort", DEFAULT_SORT);
  }

  url.search = params.toString();
  return url.toString();
}
