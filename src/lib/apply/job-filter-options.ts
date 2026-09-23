/**
 * The job finder's filters — ONE definition, used by every page that lists jobs
 * or applications: the public job finder, the dashboard's jobs page and the
 * archive of what was sent. Before this each page had its own search (a URL
 * form here, a toolbar there, a client-side box that only searched the newest
 * 200 rows), so "search" meant something different on every screen.
 *
 * Plain data and pure functions (no server-only import) so both the server query
 * and the form render from the same lists. All labels are Persian: nothing on
 * Karjoo's pages is shown in English.
 */
import { JOB_CATEGORY_SEED } from "@/lib/taxonomy/categories";

/**
 * The sites Karjoo can actually search and apply on. Only these are listed
 * anywhere public — the providers still on the roadmap are not shown as if they
 * were available.
 */
export const ACTIVE_BOARDS = ["jobinja", "jobvision", "e-estekhdam", "irantalent", "karboom"] as const;
export type ActiveBoard = (typeof ACTIVE_BOARDS)[number];

export const BOARD_LABELS: Record<ActiveBoard, string> = {
  jobinja: "جابینجا",
  jobvision: "جاب‌ویژن",
  "e-estekhdam": "ای‌استخدام",
  irantalent: "ایران‌تلنت",
  karboom: "کاربوم",
};

export function isActiveBoard(value: string | null | undefined): value is ActiveBoard {
  return (ACTIVE_BOARDS as readonly string[]).includes(value ?? "");
}

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "project", "internship"] as const;
export type EmploymentTypeFilter = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_LABELS: Record<EmploymentTypeFilter, string> = {
  full_time: "تمام‌وقت",
  part_time: "پاره‌وقت",
  project: "پروژه‌ای",
  internship: "کارآموزی",
};

/** «منتشرشده در …» — days back from now. */
export const POSTED_WITHIN = [1, 3, 7, 30] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number];

export const POSTED_LABELS: Record<PostedWithin, string> = {
  1: "۲۴ ساعت اخیر",
  3: "۳ روز اخیر",
  7: "یک هفته‌ی اخیر",
  30: "یک ماه اخیر",
};

/** Category options, in the taxonomy's own order, with its Persian labels. */
export const CATEGORY_OPTIONS: ReadonlyArray<{ slug: string; label: string }> = JOB_CATEGORY_SEED.map(
  (c) => ({ slug: c.slug, label: c.labelFa }),
);

const CATEGORY_LABEL = new Map(CATEGORY_OPTIONS.map((c) => [c.slug, c.label]));

export function categoryLabel(slug: string | null | undefined): string | null {
  return slug ? (CATEGORY_LABEL.get(slug) ?? null) : null;
}

export function isCategorySlug(value: string | null | undefined): boolean {
  return CATEGORY_LABEL.has(value ?? "");
}

export function isEmploymentType(value: string | null | undefined): value is EmploymentTypeFilter {
  return (EMPLOYMENT_TYPES as readonly string[]).includes(value ?? "");
}

export function parsePostedWithin(value: string | null | undefined): PostedWithin | null {
  const n = Number(value);
  return (POSTED_WITHIN as readonly number[]).includes(n) ? (n as PostedWithin) : null;
}

/** The unified filter state shared by every list. */
export interface UnifiedJobFilters {
  q: string | null;
  board: ActiveBoard | null;
  category: string | null;
  city: string | null;
  type: EmploymentTypeFilter | null;
  remote: boolean;
  posted: PostedWithin | null;
}

/** PURE: read the unified filters from URL parameters, dropping anything invalid. */
export function parseUnifiedJobFilters(params: Record<string, string | undefined>): UnifiedJobFilters {
  const text = (value: string | undefined, max: number) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };
  return {
    q: text(params.q, 80),
    board: isActiveBoard(params.board) ? params.board : null,
    category: isCategorySlug(params.category) ? params.category! : null,
    city: text(params.city, 60),
    type: isEmploymentType(params.type) ? params.type : null,
    remote: params.remote === "1",
    posted: parsePostedWithin(params.posted),
  };
}

/** PURE: the unified filters as URL parameters (only the ones that are set). */
export function unifiedFiltersToParams(filters: UnifiedJobFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.q) out.q = filters.q;
  if (filters.board) out.board = filters.board;
  if (filters.category) out.category = filters.category;
  if (filters.city) out.city = filters.city;
  if (filters.type) out.type = filters.type;
  if (filters.remote) out.remote = "1";
  if (filters.posted) out.posted = String(filters.posted);
  return out;
}

/** Is any filter narrowing the list? (For "clear filters" and empty states.) */
export function hasActiveFilters(filters: UnifiedJobFilters): boolean {
  return Object.keys(unifiedFiltersToParams(filters)).length > 0;
}
