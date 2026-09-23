/**
 * نشانیِ یک فهرستِ شغل با فیلترهای یکپارچه — همان پارامترها در کاریابِ عمومی و
 * داشبورد، تا یک لینکِ فیلترشده در هر دو یک معنا بدهد.
 */
import { DEFAULT_JOB_PAGE_SIZE, type ParsedJobsQuery } from "@/lib/apply/jobs-query";
import { unifiedFiltersToParams } from "@/lib/apply/job-filter-options";

export function jobsHref(
  base: string,
  state: ParsedJobsQuery,
  overrides: { page?: number; result?: string | null } = {},
): string {
  const params = new URLSearchParams(unifiedFiltersToParams(state));
  if (state.status) params.set("status", state.status);
  if (state.applied !== "all") params.set("applied", state.applied);
  if (state.sort !== "newest") params.set("sort", state.sort);
  if (state.dir !== "desc") params.set("dir", state.dir);
  const page = overrides.page ?? state.page;
  if (page > 1) params.set("page", String(page));
  if (state.pageSize !== DEFAULT_JOB_PAGE_SIZE) params.set("pageSize", String(state.pageSize));
  if (overrides.result) params.set("result", overrides.result);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
