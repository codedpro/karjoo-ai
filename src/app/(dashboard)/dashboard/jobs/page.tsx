import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SquareArrowOutUpRight } from "lucide-react";

import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonCard,
  ScoreRing,
  TableFrame,
  toFaDigits,
} from "@/components/dashboard/ui";
import {
  IconBolt,
  IconCompass,
  IconPlug,
  IconRefresh,
  IconSearch,
  IconSend,
} from "@/components/dashboard/icons";
import { APPLY_TABS, SectionTabs } from "@/components/dashboard/section-tabs";
import {
  DEFAULT_JOB_PAGE_SIZE,
  JOB_MATCH_STATUSES,
  JOB_SORTS,
  listUnifiedJobsPage,
  parseJobsQuery,
  type ParsedJobsQuery,
  type UnifiedJobRow,
} from "@/lib/apply/jobs-query";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";
import { publicProviderCapabilities } from "@/lib/apply/registry";

import { queueJobApplyAction } from "./actions";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "جست‌وجوی شغل",
  robots: { index: false, follow: false },
};

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  const state = parseJobsQuery(flat);
  const currentHref = jobsHref(state, { result: flat.result });

  return (
    <div className="space-y-6">
      <PageHeader
        title="جست‌وجوی شغل"
        subtitle={`همه‌ی آگهی‌های تازه‌ی ارائه‌دهنده‌ها در یک فهرست؛ همگام‌سازی هیچ صفحه‌ای قدیمی‌تر از ${toFaDigits(MAX_PROVIDER_SYNC_AGE_DAYS)} روز را واکشی نمی‌کند.`}
        actions={
          <ButtonLink href="/dashboard/auto-apply" variant="secondary" size="sm">
            <IconRefresh className="h-4 w-4" />
            پیدا کردن شغل‌های تازه
          </ButtonLink>
        }
      />
      <SectionTabs tabs={APPLY_TABS} active="/dashboard/jobs" ariaLabel="زبانه‌های اپلای‌ها" />
      <ResultNote result={flat.result} />
      <JobsFilters state={state} />

      <Suspense key={JSON.stringify(state)} fallback={<JobsSkeleton />}>
        <JobsSection userId={user.userId} state={state} currentHref={currentHref} />
      </Suspense>
    </div>
  );
}

async function JobsSection({
  userId,
  state,
  currentHref,
}: {
  userId: string;
  state: ParsedJobsQuery;
  currentHref: string;
}) {
  const page = await listUnifiedJobsPage(userId, state);

  if (page.filteredTotal === 0) {
    return (
      <EmptyState
        icon={<IconCompass />}
        title={
          state.applied === "not_applied"
            ? "فعلاً شغلِ آماده‌ی اپلای پیدا نشد"
            : "با این فیلتر شغلی پیدا نشد"
        }
        body="ارائه‌دهنده‌ها را وصل کن، جست‌وجو را سبک‌تر کن، یا یک همگام‌سازی تازه اجرا کن تا آگهی‌های جدید وارد فهرست شوند."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ButtonLink href="/dashboard/extension" size="sm">
              <IconPlug className="h-4 w-4" />
              اتصال ارائه‌دهنده‌ها
            </ButtonLink>
            <ButtonLink href="/dashboard/jobs?applied=all" variant="secondary" size="sm">
              نمایش همه‌ی آگهی‌ها
            </ButtonLink>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="brand">
            <span className="ltr-nums tabular-nums">{toFaDigits(page.filteredTotal)}</span>
            &nbsp;آگهی
          </Badge>
          <span>صفحه‌ی <span className="ltr-nums">{toFaDigits(page.page)}</span> از <span className="ltr-nums">{toFaDigits(page.pageCount)}</span></span>
        </div>
        {state.applied === "not_applied" ? (
          <Badge tone="green">فقط اپلای‌نشده‌ها</Badge>
        ) : state.applied === "applied" ? (
          <Badge tone="amber">فقط اپلای‌شده‌ها</Badge>
        ) : (
          <Badge tone="muted">همه‌ی وضعیت‌ها</Badge>
        )}
      </div>

      <div className="space-y-3">
        {page.items.map((job) => (
          <JobRow key={job.id} job={job} currentHref={currentHref} />
        ))}
      </div>

      <Pagination state={state} pageCount={page.pageCount} />
    </div>
  );
}

function JobsFilters({ state }: { state: ParsedJobsQuery }) {
  return (
    <TableFrame className="rounded-xl" minWidth="42rem">
      <form
        action="/dashboard/jobs"
        method="get"
        className="grid gap-3 p-4 lg:grid-cols-[1.5fr_1fr_1fr_auto]"
      >
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">جست‌وجو</span>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <IconSearch className="h-4 w-4 text-muted" />
            <input
              name="q"
              defaultValue={state.q ?? ""}
              placeholder="عنوان، شرکت، شهر..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
            />
          </div>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">ارائه‌دهنده</span>
          <select
            name="board"
            defaultValue={state.board ?? ""}
            className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none"
          >
            <option value="">همه</option>
            {publicProviderCapabilities().map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">شهر</span>
          <input
            name="city"
            defaultValue={state.city ?? ""}
            placeholder="مثلاً تهران"
            className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none placeholder:text-muted/60"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[9rem_8rem] lg:self-end">
          <select
            name="applied"
            defaultValue={state.applied}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm outline-none"
          >
            <option value="not_applied">اپلای‌نشده</option>
            <option value="all">همه</option>
            <option value="applied">اپلای‌شده</option>
          </select>
          <button className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-brand-foreground transition-transform hover:-translate-y-0.5 active:translate-y-px">
            <IconSearch className="h-4 w-4" />
            جست‌وجو
          </button>
        </div>

        <div className="flex flex-wrap gap-2 lg:col-span-4">
          <select
            name="status"
            defaultValue={state.status ?? ""}
            className="h-9 rounded-full border border-border bg-surface px-3 text-xs outline-none"
          >
            <option value="">همه‌ی تطبیق‌ها</option>
            {JOB_MATCH_STATUSES.map((status) => (
              <option key={status} value={status}>
                {matchStatusLabel(status)}
              </option>
            ))}
          </select>
          <select
            name="sort"
            defaultValue={state.sort}
            className="h-9 rounded-full border border-border bg-surface px-3 text-xs outline-none"
          >
            {JOB_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {sortLabel(sort)}
              </option>
            ))}
          </select>
          <select
            name="dir"
            defaultValue={state.dir}
            className="h-9 rounded-full border border-border bg-surface px-3 text-xs outline-none"
          >
            <option value="desc">نزولی</option>
            <option value="asc">صعودی</option>
          </select>
          <input type="hidden" name="pageSize" value={state.pageSize} />
          <Link
            href="/dashboard/jobs"
            className="focus-ring inline-flex h-9 items-center rounded-full px-3 text-xs font-semibold text-muted hover:bg-foreground/5 hover:text-foreground"
          >
            حذف فیلترها
          </Link>
        </div>
      </form>
    </TableFrame>
  );
}

function JobRow({ job, currentHref }: { job: UnifiedJobRow; currentHref: string }) {
  const statusTone = job.alreadyApplied ? "green" : job.canEasyApply ? "brand" : "muted";
  return (
    <Card className="overflow-hidden rounded-xl">
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={providerTone(job.providerWorkflowState)}>
              {job.providerName}
            </Badge>
            <Badge tone={statusTone}>{jobStatusLabel(job)}</Badge>
            {job.salary ? <Badge tone="muted">{job.salary}</Badge> : null}
            {job.city ? <Badge tone="muted">{job.city}</Badge> : null}
          </div>
          <div>
            <h2 className="text-pretty text-base font-extrabold leading-7">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring rounded-md hover:text-brand"
              >
                {job.title}
              </a>
            </h2>
            <p className="mt-1 text-sm text-muted">
              {job.company ?? "شرکت نامشخص"} · {formatFaDate(job.postedAt) ?? "تاریخ انتشار نامشخص"} ·
              آخرین مشاهده {formatFaDate(job.lastSeenAt)}
            </p>
          </div>
          {job.matchReason ? (
            <p className="line-clamp-2 max-w-3xl text-pretty text-sm leading-7 text-muted">
              {job.matchReason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {job.matchScore !== null ? <ScoreRing score={job.matchScore} /> : null}
          <div className="flex flex-wrap gap-2">
            {job.canEasyApply ? (
              <form action={queueJobApplyAction}>
                <input type="hidden" name="listingId" value={job.id} />
                <input type="hidden" name="returnTo" value={currentHref} />
                <button className="focus-ring inline-flex items-center justify-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition-transform hover:-translate-y-0.5 active:translate-y-px">
                  <IconSend className="h-4 w-4" />
                  اپلای با کارجو
                </button>
              </form>
            ) : (
              <DisabledAction job={job} />
            )}
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/5"
            >
              <SquareArrowOutUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              سایت اصلی
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}

function DisabledAction({ job }: { job: UnifiedJobRow }) {
  if (job.alreadyApplied) {
    return (
      <span className="inline-flex items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
        قبلاً اپلای شده
      </span>
    );
  }
  if (job.providerWorkflowState !== "live") {
    return (
      <span className="inline-flex items-center justify-center rounded-full border border-border bg-foreground/5 px-4 py-2 text-sm font-semibold text-muted">
        در حال تکمیل
      </span>
    );
  }
  if (job.accountStatus !== "connected") {
    return (
      <ButtonLink href="/dashboard/extension" variant="secondary" size="sm">
        <IconPlug className="h-4 w-4" />
        اتصال لازم است
      </ButtonLink>
    );
  }
  return (
    <span className="inline-flex items-center justify-center rounded-full border border-border bg-foreground/5 px-4 py-2 text-sm font-semibold text-muted">
      آماده نیست
    </span>
  );
}

function Pagination({ state, pageCount }: { state: ParsedJobsQuery; pageCount: number }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {state.page > 1 ? (
        <ButtonLink href={jobsHref(state, { page: state.page - 1 })} variant="secondary" size="sm">
          صفحه‌ی قبل
        </ButtonLink>
      ) : null}
      <Badge tone="muted">
        <span className="ltr-nums">{toFaDigits(state.page)}</span>
        /
        <span className="ltr-nums">{toFaDigits(pageCount)}</span>
      </Badge>
      {state.page < pageCount ? (
        <ButtonLink href={jobsHref(state, { page: state.page + 1 })} variant="secondary" size="sm">
          صفحه‌ی بعد
        </ButtonLink>
      ) : null}
    </div>
  );
}

function ResultNote({ result }: { result: string | undefined }) {
  const map: Record<string, { tone: "success" | "warn" | "danger" | "info"; text: string }> = {
    queued: { tone: "success", text: "این شغل وارد صف اپلای شد." },
    already_queued: { tone: "info", text: "این شغل از قبل در صف اپلای بود." },
    duplicate: { tone: "warn", text: "برای این شغل قبلاً درخواست ثبت شده است." },
    connect: { tone: "warn", text: "برای اپلای، اتصال همان ارائه‌دهنده باید فعال باشد." },
    provider: { tone: "warn", text: "اپلای مستقیم برای این ارائه‌دهنده هنوز کامل منتشر نشده است." },
    stale: { tone: "warn", text: "این آگهی خارج از بازه‌ی تازه‌ی ۴۵ روزه است." },
    missing: { tone: "danger", text: "آگهی پیدا نشد یا دیگر در دسترس نیست." },
    dismissed: { tone: "warn", text: "این شغل قبلاً توسط کاربر رد شده است." },
    invalid: { tone: "danger", text: "درخواست اپلای معتبر نبود." },
  };
  const item = result ? map[result] : null;
  if (!item) return null;
  return (
    <Callout tone={item.tone} icon={<IconBolt />}>
      {item.text}
    </Callout>
  );
}

function JobsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-6 w-32 rounded-full" />
      {Array.from({ length: 5 }).map((_, index) => (
        <SkeletonCard key={index} className="h-32" />
      ))}
    </div>
  );
}

function jobsHref(
  state: ParsedJobsQuery,
  overrides: Partial<Record<keyof ParsedJobsQuery | "result", string | number | null | undefined>> = {},
) {
  const params = new URLSearchParams();
  const next = { ...state, ...overrides };
  if (next.q) params.set("q", String(next.q));
  if (next.board) params.set("board", String(next.board));
  if (next.city) params.set("city", String(next.city));
  if (next.status) params.set("status", String(next.status));
  if (next.applied && next.applied !== "not_applied") params.set("applied", String(next.applied));
  if (next.sort && next.sort !== "newest") params.set("sort", String(next.sort));
  if (next.dir && next.dir !== "desc") params.set("dir", String(next.dir));
  if (next.page && Number(next.page) > 1) params.set("page", String(next.page));
  if (next.pageSize && Number(next.pageSize) !== DEFAULT_JOB_PAGE_SIZE) params.set("pageSize", String(next.pageSize));
  if (next.result) params.set("result", String(next.result));
  const qs = params.toString();
  return qs ? `/dashboard/jobs?${qs}` : "/dashboard/jobs";
}

function formatFaDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(date);
}

function providerTone(state: UnifiedJobRow["providerWorkflowState"]) {
  if (state === "live") return "green";
  if (state === "in_progress") return "amber";
  return "muted";
}

function matchStatusLabel(status: string): string {
  return {
    pending: "در انتظار امتیاز",
    scored: "امتیازدهی‌شده",
    drafted: "آماده‌ی پیش‌نویس",
    queued: "در صف اپلای",
    dismissed: "رد شده",
  }[status] ?? status;
}

function sortLabel(sort: string): string {
  return {
    newest: "جدیدترین",
    score: "امتیاز تطبیق",
    company: "شرکت",
    provider: "ارائه‌دهنده",
  }[sort] ?? sort;
}

function jobStatusLabel(job: UnifiedJobRow): string {
  if (job.providerStatus) return providerStatusLabel(job.providerStatus);
  if (job.applicationStatus === "submitted") return "ارسال‌شده";
  if (job.applicationStatus === "draft") return "پیش‌نویس";
  if (job.matchStatus) return matchStatusLabel(job.matchStatus);
  return "تازه";
}

function providerStatusLabel(status: string): string {
  return {
    pending: "در انتظار بررسی",
    review: "در حال بررسی",
    interview: "مصاحبه",
    hired: "استخدام",
    rejected: "رد شده",
    other: "وضعیت دیگر",
  }[status] ?? status;
}
