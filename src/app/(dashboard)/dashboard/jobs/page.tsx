import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { ButtonLink, PageHeader } from "@/components/dashboard/ui";
import { IconRefresh } from "@/components/dashboard/icons";
import { APPLY_TABS, SectionTabs } from "@/components/dashboard/section-tabs";
import { JobFiltersForm } from "@/components/jobs/job-filters-form";
import { JobList, JobListSkeleton, JobResultNote, PersonalJobFilters } from "@/components/jobs/job-list";
import { listJobCityOptions, parseJobsQuery } from "@/lib/apply/jobs-query";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "جست‌وجوی شغل",
  robots: { index: false, follow: false },
};

const BASE = "/dashboard/jobs";

/**
 * همان کاریابِ عمومی (همان فیلترها، همان کارت‌ها)، به‌اضافه‌ی فیلترهای شخصی: وضعیتِ
 * اپلای، وضعیتِ تطبیق و مرتب‌سازی بر اساسِ امتیاز.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const [raw, cities] = await Promise.all([searchParams, listJobCityOptions()]);
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  const state = parseJobsQuery(flat);

  return (
    <div className="space-y-6">
      <PageHeader
        title="جست‌وجوی شغل"
        subtitle="آگهی‌های تازه‌ی همه‌ی سایت‌ها در یک فهرست، با همان فیلترهای کاریاب و بایگانی."
        actions={
          <ButtonLink href="/dashboard/auto-apply" variant="secondary" size="sm">
            <IconRefresh className="h-4 w-4" />
            پیدا کردنِ شغل‌های تازه
          </ButtonLink>
        }
      />
      <SectionTabs tabs={APPLY_TABS} active="/dashboard/jobs" ariaLabel="زبانه‌های اپلای‌ها" />
      <JobResultNote result={flat.result} />
      <JobFiltersForm
        action={BASE}
        filters={state}
        cities={cities}
        extra={<PersonalJobFilters state={state} full />}
      />

      <Suspense key={JSON.stringify(state)} fallback={<JobListSkeleton />}>
        <JobList base={BASE} userId={user.userId} state={state} />
      </Suspense>
    </div>
  );
}
