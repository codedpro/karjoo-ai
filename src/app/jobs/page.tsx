/**
 * کاریاب — فهرستِ عمومیِ همه‌ی آگهی‌های تازه‌ی پنج سایتی که کارجو واقعاً روی‌شان
 * جست‌وجو و اپلای می‌کند، با همان فیلترهای یکپارچه‌ی داشبورد و بایگانی.
 *
 * هر آگهی دو راه دارد: دیدنش در سایتِ اصلی، یا اپلای با کارجو (رزومه‌ی متناسب با
 * همان آگهی ساخته و از طرفِ کاربر فرستاده می‌شود). همه‌ی متن‌ها فارسی‌اند.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/logo";
import { getDashboardUser } from "@/components/dashboard/session";
import { ButtonLink } from "@/components/dashboard/ui";
import { JobFiltersForm } from "@/components/jobs/job-filters-form";
import { JobList, JobListSkeleton, JobResultNote, PersonalJobFilters } from "@/components/jobs/job-list";
import { listJobCityOptions, parseJobsQuery } from "@/lib/apply/jobs-query";
import { ACTIVE_BOARDS, BOARD_LABELS } from "@/lib/apply/job-filter-options";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "کاریاب — همه‌ی آگهی‌های استخدام در یک‌جا",
  description:
    "آگهی‌های تازه‌ی جابینجا، جاب‌ویژن، ای‌استخدام، ایران‌تلنت و کاربوم در یک فهرست، با فیلترِ یکسان. آگهی را در سایتِ اصلی ببین یا با کارجو اپلای کن.",
  alternates: { canonical: "/jobs" },
  robots: { index: true, follow: true },
};

const BASE = "/jobs";

export default async function PublicJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, raw, cities] = await Promise.all([getDashboardUser(), searchParams, listJobCityOptions()]);
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  const state = parseJobsQuery(flat);

  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="dash-container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="focus-ring flex items-center rounded-lg" aria-label="کارجو — خانه">
            <Logo size={32} title="کارجو" className="text-foreground" />
          </Link>
          <nav className="hidden items-center gap-5 text-sm font-semibold text-muted md:flex">
            <Link href="/jobs" className="text-foreground">کاریاب</Link>
            <Link href="/#boards" className="hover:text-foreground">سایت‌ها</Link>
            <Link href="/#extension" className="hover:text-foreground">افزونه</Link>
          </nav>
          <ButtonLink href={user ? "/dashboard" : "/login"} variant="secondary" size="sm">
            {user ? "داشبورد" : "ورود"}
          </ButtonLink>
        </div>
      </header>

      <div className="dash-container space-y-6 py-8">
        <section className="space-y-3">
          <h1 className="text-balance text-2xl font-extrabold leading-10 sm:text-3xl">
            کاریاب: همه‌ی آگهی‌های استخدام در یک‌جا
          </h1>
          <p className="max-w-3xl text-pretty text-sm leading-7 text-muted">
            آگهی‌های تازه‌ی{" "}
            {ACTIVE_BOARDS.map((board, i) => (
              <span key={board}>
                {i > 0 ? (i === ACTIVE_BOARDS.length - 1 ? " و " : "، ") : null}
                <Link href={`${BASE}?board=${board}`} className="font-semibold text-foreground hover:text-brand">
                  {BOARD_LABELS[board]}
                </Link>
              </span>
            ))}{" "}
            را این‌جا با یک فیلترِ یکسان بگرد. هر آگهی را می‌توانی در سایتِ اصلی ببینی یا با کارجو اپلای کنی — رزومه‌ی
            متناسب با همان آگهی ساخته و برایت فرستاده می‌شود.
          </p>
        </section>

        <JobResultNote result={flat.result} />

        <JobFiltersForm
          action={BASE}
          filters={state}
          cities={cities}
          extra={user ? <PersonalJobFilters state={state} /> : undefined}
        />

        <Suspense key={JSON.stringify({ state, userId: user?.userId ?? null })} fallback={<JobListSkeleton />}>
          <JobList base={BASE} userId={user?.userId ?? null} state={state} />
        </Suspense>
      </div>
    </main>
  );
}

