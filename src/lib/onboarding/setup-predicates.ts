/**
 * «راه‌اندازیِ کارجو کامل شده؟» — تشخیص‌های خالص (بدونِ DB) تا مستقل تست شوند.
 *
 * سه گامی که بدونِ آن‌ها کارجو نمی‌تواند برای کاربر اپلای کند:
 *   ۱) رزومه — یک فایلِ آپلودشده، یا پروفایلی با نامِ واقعی و مهارت.
 *   ۲) هدف‌گیری — دستِ‌کم یک سایتِ فعال با شرطِ مشخص (زمینه/شهر/نوعِ همکاری/دورکاری)،
 *      یا فیلترهای سراسریِ قدیمی.
 *   ۳) اتصال — دستِ‌کم یک سایتِ کاریابی که از راهِ افزونه وصل شده.
 */
import type { ApplyFilters } from "@/lib/apply/filters";

/**
 * نوشتنِ فیلترها پیش از رزومه یک پروفایلِ استاب با همین نام و بدونِ مهارت می‌سازد؛
 * پس صرفِ وجودِ پروفایل یعنی رزومه نیست.
 */
export const STUB_FULL_NAME = "کاربر کارجو";

export function isResumeReady(
  profile: { fullName: string; skills: readonly unknown[] } | null,
  fileCount: number,
): boolean {
  if (fileCount > 0) return true;
  if (!profile) return false;
  const name = profile.fullName.trim();
  return name !== "" && name !== STUB_FULL_NAME && profile.skills.length > 0;
}

export function isTargetingReady(
  filters: Pick<ApplyFilters, "categorySlugs" | "cities" | "jobTypes" | "boardFilters">,
): boolean {
  if (filters.categorySlugs.length > 0 || filters.cities.length > 0 || filters.jobTypes.length > 0) {
    return true;
  }
  return Object.values(filters.boardFilters).some(
    (b) =>
      b.enabled &&
      (b.categoryKeys.length > 0 ||
        b.cities.length > 0 ||
        b.employmentTypeKeys.length > 0 ||
        b.remoteOnly),
  );
}

export function isBoardConnected(accounts: ReadonlyArray<{ status: string }>): boolean {
  return accounts.some((a) => a.status === "connected");
}
