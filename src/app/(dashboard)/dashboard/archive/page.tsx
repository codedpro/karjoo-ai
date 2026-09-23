/**
 * «بایگانیِ ارسال‌ها» — سابقه‌ی کاملِ آن‌چه *ما* از طرفِ کاربر فرستاده‌ایم.
 *
 * سه صفحه‌ی تاریخچه با *سؤالی که جواب می‌دهند* از هم جدا شده‌اند و کاربر نباید حتی یک
 * لحظه بپرسد «چرا سه تا؟». پس این صفحه یک جمله‌ی بازکننده دارد و یک یادداشتِ کوتاه که
 * مرزش را با «پرونده‌ی جابینجا» صریح می‌گوید:
 *   • این‌جا: چه فرستادیم و با کدام نسخه‌ی رزومه (دفترِ خودِ ما).
 *   • پرونده‌ی جابینجا: کارفرما در سایتِ خودش چه وضعیتی ثبت کرده (آینه‌ی سایت).
 *   • وضعیتِ اپلای‌ها: همین حالا چه چیزی در حالِ ارسال است.
 *
 * چیدمان: پوسته‌ی داشبورد خودش `.dash-container` (سیالِ سقف‌دار) و بالشتک دارد؛ این صفحه
 * هیچ `mx-auto max-w-*`ی نمی‌سازد — قبلاً می‌ساخت و نتیجه‌اش دو-بار-بالشتک و ستونِ باریک
 * در نمایشگرِ بزرگ بود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { IconArchive, IconBolt, IconChart } from "@/components/dashboard/icons";
import {
  ButtonLink,
  Callout,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonTable,
  toFaDigits,
} from "@/components/dashboard/ui";
import {
  ApplicationArchiveTable,
  type ArchiveRow,
} from "@/components/dashboard/application-archive-table";
import { JobFiltersForm } from "@/components/jobs/job-filters-form";
import { listApplicationArchivePage } from "@/lib/apply/application-archive";
import { listJobCityOptions } from "@/lib/apply/jobs-query";
import {
  hasActiveFilters,
  parseUnifiedJobFilters,
  unifiedFiltersToParams,
  type UnifiedJobFilters,
} from "@/lib/apply/job-filter-options";
import { SectionTabs, APPLY_TABS } from "@/components/dashboard/section-tabs";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "بایگانیِ ارسال‌ها",
  robots: { index: false, follow: false },
};

const BASE = "/dashboard/archive";

export default async function ArchivePage({
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
  // همان فیلترهای کاریاب و صفحه‌ی شغل‌ها — «تاریخِ انتشار» این‌جا معنا ندارد.
  const filters: UnifiedJobFilters = { ...parseUnifiedJobFilters(flat), posted: null };
  const page = Math.max(1, Number.parseInt(flat.page ?? "1", 10) || 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="بایگانیِ ارسال‌ها"
        subtitle="هر درخواستی که ما از طرفِ تو فرستادیم — با شرحِ همان آگهی و همان نسخه‌ای از رزومه که واقعاً ارسال شد."
      />
      <SectionTabs tabs={APPLY_TABS} active="/dashboard/archive" ariaLabel="زبانه‌های اپلای‌ها" />

      <Callout
        icon={<IconChart />}
        title="این‌جا کارِ ماست، نه پاسخِ کارفرما"
      >
        برای دیدنِ اینکه کارفرما درخواستت را در چه مرحله‌ای دیده، سراغِ «پرونده‌ی
        جابینجا» برو.
      </Callout>

      <JobFiltersForm action={BASE} filters={filters} cities={cities} showPosted={false} />

      <Suspense key={JSON.stringify({ filters, page })} fallback={<ArchiveSkeleton />}>
        <ArchiveSection userId={user.userId} filters={filters} page={page} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ArchiveSection({
  userId,
  filters,
  page: requestedPage,
}: {
  userId: string;
  filters: UnifiedJobFilters;
  page: number;
}) {
  const { items, total, page, pageCount } = await listApplicationArchivePage(userId, {
    filters,
    page: requestedPage,
  });

  // تاریخ‌ها برای مرزِ سرور→کلاینت باید سریال‌پذیر باشند.
  const rows: ArchiveRow[] = items.map((i) => ({
    ...i,
    submittedAt: i.submittedAt ? i.submittedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));

  if (rows.length === 0) {
    if (hasActiveFilters(filters)) {
      return (
        <EmptyState
          icon={<IconArchive />}
          title="با این فیلترها ارسالی پیدا نشد"
          body="یکی دو فیلتر را بردار یا جست‌وجو را کوتاه‌تر کن."
          action={
            <ButtonLink href={BASE} variant="secondary" size="sm">
              نمایشِ همه‌ی ارسال‌ها
            </ButtonLink>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={<IconArchive />}
        title="هنوز چیزی فرستاده نشده"
        body="به‌محضِ اولین ارسال، شرکت، شرحِ شغل و همان رزومه‌ای که فرستادیم این‌جا بایگانی می‌شود."
        action={
          <ButtonLink href="/dashboard/auto-apply" size="sm">
            <IconBolt className="h-4 w-4" />
            روشن‌کردنِ اپلای خودکار
          </ButtonLink>
        }
      />
    );
  }

  const pageHref = (n: number) => {
    const params = new URLSearchParams(unifiedFiltersToParams(filters));
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        {toFaDigits(total)} ارسال
        {pageCount > 1 ? ` — صفحه‌ی ${toFaDigits(page)} از ${toFaDigits(pageCount)}` : ""}
      </p>
      <ApplicationArchiveTable rows={rows} />
      {pageCount > 1 ? (
        <nav aria-label="صفحه‌ها" className="flex flex-wrap items-center justify-center gap-2">
          {page > 1 ? (
            <ButtonLink href={pageHref(page - 1)} variant="secondary" size="sm">
              صفحه‌ی قبل
            </ButtonLink>
          ) : null}
          {page < pageCount ? (
            <ButtonLink href={pageHref(page + 1)} variant="secondary" size="sm">
              صفحه‌ی بعد
            </ButtonLink>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

/* ─────────────────────── اسکلتِ هم‌شکلِ محتوا ─────────────────────── */

/** هم‌شکلِ محتوا: خطِ خلاصه + جدول. */
function ArchiveSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-3 w-40" />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
