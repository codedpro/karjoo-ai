import "server-only";

/**
 * «برای این کاربر روی هر سایت دنبالِ چه بگردیم؟» — مشترک بینِ افزونه و ناوگان.
 *
 * این منطق پیش‌تر داخلِ `GET /api/extension/discovery` بود و فقط افزونه آن را
 * می‌خواند. حالا نودِ ناوگان هم همان جست‌وجو را ۲۴/۷ از سمتِ سرور اجرا می‌کند، پس
 * هر دو باید دقیقاً یک تعریف از «هدف‌گیریِ این سایت» داشته باشند — دو نسخه یعنی
 * دیر یا زود افزونه چیزی پیدا کند که سرور نمی‌بیند (یا برعکس).
 *
 * «هدف‌گیری» عمداً شرط است: سایتی که کاربر هیچ دسته/شهر/نوعِ همکاری/دورکاری برایش
 * نگذاشته، جست‌وجو نمی‌شود. جست‌وجوی بی‌فیلتر یعنی تازه‌ترین آگهی‌های کلِ سایت — و
 * اپلای خودکار به شغل‌های نامرتبط.
 */
import type { ApplyFilters } from "@/lib/apply/filters";
import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import type { JobListing, JobPreferences } from "@/lib/apply/types";

export type DiscoveryBoard = "jobinja" | "jobvision" | "e-estekhdam" | "irantalent" | "karboom";

export interface DiscoveryBoardSpec {
  board: DiscoveryBoard;
  enabled: boolean;
  hasTargeting: boolean;
  /** فقط جابینجا — نشانیِ جست‌وجوی آماده، ساخته‌شده از ترجیحاتِ کلیِ کاربر. */
  searchUrl?: string | null;
  categoryKeys?: string[];
  /**
   * JobVision only, filled by the fleet: the Persian label of each category key.
   * The node reads JobVision postings from their schema.org JobPosting, whose
   * occupationalCategory carries this label — not the key.
   */
  categoryLabels?: string[];
  cities?: string[];
  employmentTypeKeys?: string[];
  remoteOnly?: boolean;
}

/** PURE: مشخصاتِ جست‌وجوی هر پنج سایت از فیلترهای کاربر. */
export function discoveryBoardSpecs(
  filters: ApplyFilters,
  prefs: JobPreferences,
): DiscoveryBoardSpec[] {
  const hasGlobalTargeting = Boolean(
    prefs.categorySlugs?.length ||
      prefs.cities?.length ||
      prefs.jobTypes?.length ||
      prefs.titles?.length ||
      prefs.remoteOnly,
  );
  const jobvision = filters.boardFilters.jobvision;
  const eEstekhdam = filters.boardFilters["e-estekhdam"];
  const irantalent = filters.boardFilters.irantalent;
  const karboom = filters.boardFilters.karboom;

  return [
    {
      board: "jobinja",
      enabled: filters.boardFilters.jobinja.enabled,
      hasTargeting: hasGlobalTargeting,
      searchUrl: hasGlobalTargeting ? buildSearchUrl({ ...prefs, sort: "published_at_desc" }, 1) : null,
    },
    {
      board: "jobvision",
      enabled: jobvision.enabled,
      hasTargeting:
        jobvision.categoryKeys.length > 0 ||
        jobvision.remoteOnly ||
        jobvision.employmentTypeKeys.length > 0,
      categoryKeys: jobvision.categoryKeys,
      employmentTypeKeys: jobvision.employmentTypeKeys,
      remoteOnly: jobvision.remoteOnly,
    },
    {
      board: "e-estekhdam",
      enabled: eEstekhdam.enabled,
      hasTargeting:
        eEstekhdam.categoryKeys.length > 0 ||
        eEstekhdam.cities.length > 0 ||
        eEstekhdam.remoteOnly ||
        eEstekhdam.employmentTypeKeys.length > 0,
      categoryKeys: eEstekhdam.categoryKeys,
      cities: eEstekhdam.cities,
      employmentTypeKeys: eEstekhdam.employmentTypeKeys,
      remoteOnly: eEstekhdam.remoteOnly,
    },
    {
      board: "irantalent",
      enabled: irantalent.enabled,
      hasTargeting:
        irantalent.categoryKeys.length > 0 ||
        irantalent.remoteOnly ||
        irantalent.employmentTypeKeys.length > 0,
      categoryKeys: irantalent.categoryKeys,
      employmentTypeKeys: irantalent.employmentTypeKeys,
      remoteOnly: irantalent.remoteOnly,
    },
    {
      board: "karboom",
      enabled: karboom.enabled,
      hasTargeting:
        karboom.categoryKeys.length > 0 ||
        karboom.cities.length > 0 ||
        karboom.remoteOnly ||
        karboom.employmentTypeKeys.length > 0,
      categoryKeys: karboom.categoryKeys,
      cities: karboom.cities,
      employmentTypeKeys: karboom.employmentTypeKeys,
      remoteOnly: karboom.remoteOnly,
    },
  ];
}

/** آگهیِ کشف‌شده، به همان شکلی که افزونه و نود می‌فرستند. */
export interface DiscoveredListingInput {
  externalId: string;
  title: string;
  company?: string | null;
  city?: string | null;
  url: string;
  description?: string | null;
  salary?: string | null;
  postedAt: string;
  gender?: string | null;
  alreadyApplied?: boolean;
}

/**
 * PURE: آگهی‌های کشف‌شده → `JobListing`ِ دامنه.
 *
 * آگهی‌ای که خودِ سایت گفته قبلاً اپلای شده کنار می‌رود؛ جنسیت (وقتی سایت اعلام کند)
 * به توضیحات چسبانده می‌شود تا فیلترِ جنسیتِ پروفایل رویش کار کند.
 */
export function toJobListings(board: DiscoveryBoard, items: DiscoveredListingInput[]): JobListing[] {
  return items
    .filter((item) => item.alreadyApplied !== true)
    .map((item) => ({
      id: `${board}:${item.externalId}`,
      board,
      externalId: item.externalId,
      title: item.title,
      company: item.company ?? undefined,
      city: item.city ?? undefined,
      url: item.url,
      description:
        [item.description ?? undefined, item.gender ? `جنسیت: ${item.gender}` : undefined]
          .filter(Boolean)
          .join("\n") || undefined,
      salary: item.salary ?? undefined,
      postedAt: item.postedAt,
    }));
}
