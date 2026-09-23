/**
 * فهرستِ یکپارچه‌ی آگهی‌ها — همان کارت، همان دکمه‌ها و همان پیام‌ها در کاریابِ عمومی
 * و در داشبورد. هر آگهی دو راه دارد: «مشاهده در [سایت]» و «اپلای با کارجو».
 */
import { SquareArrowOutUpRight } from "lucide-react";

import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Skeleton,
  SkeletonCard,
  ScoreRing,
  toFaDigits,
} from "@/components/dashboard/ui";
import { IconBolt, IconCompass, IconPlug, IconSend } from "@/components/dashboard/icons";
import { jobsHref } from "@/components/jobs/jobs-href";
import {
  JOB_MATCH_STATUSES,
  JOB_SORTS,
  listUnifiedJobsPage,
  type ParsedJobsQuery,
  type UnifiedJobRow,
} from "@/lib/apply/jobs-query";
import {
  BOARD_LABELS,
  EMPLOYMENT_LABELS,
  categoryLabel,
  hasActiveFilters,
  isActiveBoard,
} from "@/lib/apply/job-filter-options";
import { queueJobApplyAction } from "@/app/(dashboard)/dashboard/jobs/actions";

export async function JobList({
  base,
  userId,
  state,
}: {
  /** مسیرِ صفحه (/jobs یا /dashboard/jobs). */
  base: string;
  userId: string | null;
  state: ParsedJobsQuery;
}) {
  const page = await listUnifiedJobsPage(userId, state);
  const currentHref = jobsHref(base, state);

  if (page.filteredTotal === 0) {
    return (
      <EmptyState
        icon={<IconCompass />}
        title="با این فیلترها آگهی‌ای پیدا نشد"
        body="یکی دو فیلتر را بردار یا جست‌وجو را کوتاه‌تر کن. آگهی‌های تازه هر چند ساعت اضافه می‌شوند."
        action={
          hasActiveFilters(state) || state.applied !== "all" || state.status ? (
            <ButtonLink href={base} variant="secondary" size="sm">
              نمایشِ همه‌ی آگهی‌ها
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="brand">
          <span className="tabular-nums">{toFaDigits(page.filteredTotal)}</span>&nbsp;آگهی
        </Badge>
        {page.pageCount > 1 ? (
          <span>
            صفحه‌ی {toFaDigits(page.page)} از {toFaDigits(page.pageCount)}
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        {page.items.map((job) => (
          <JobCard key={job.id} job={job} isAuthenticated={Boolean(userId)} currentHref={currentHref} />
        ))}
      </div>

      <JobPagination base={base} state={state} pageCount={page.pageCount} />
    </div>
  );
}

export function siteLabel(board: string, fallback: string): string {
  return isActiveBoard(board) ? BOARD_LABELS[board] : fallback;
}

function JobCard({
  job,
  isAuthenticated,
  currentHref,
}: {
  job: UnifiedJobRow;
  isAuthenticated: boolean;
  currentHref: string;
}) {
  const site = siteLabel(job.board, job.providerName);
  const category = categoryLabel(job.category);
  const city = job.cityNorm ?? job.city;
  const status = personalStatusLabel(job);
  return (
    <Card className="overflow-hidden rounded-xl">
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{site}</Badge>
            {category ? <Badge tone="muted">{category}</Badge> : null}
            {job.employmentType ? <Badge tone="muted">{EMPLOYMENT_LABELS[job.employmentType]}</Badge> : null}
            {job.isRemote ? <Badge tone="green">دورکاری</Badge> : null}
            {status ? <Badge tone={job.alreadyApplied ? "green" : "amber"}>{status}</Badge> : null}
          </div>
          <h2 className="text-pretty text-base font-extrabold leading-7">
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded-md hover:text-brand">
              {job.title}
            </a>
          </h2>
          <p className="text-sm text-muted">
            {[job.company ?? "شرکتِ نامشخص", city, job.salary, formatFaDate(job.postedAt ?? job.ingestedAt)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {job.matchReason ? (
            <p className="line-clamp-2 max-w-3xl text-pretty text-sm leading-7 text-muted">{job.matchReason}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          {job.matchScore !== null ? <ScoreRing score={job.matchScore} /> : null}
          <div className="flex flex-wrap gap-2">
            <ApplyAction job={job} isAuthenticated={isAuthenticated} currentHref={currentHref} />
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-foreground/20 hover:bg-foreground/5"
            >
              <SquareArrowOutUpRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              مشاهده در {site}
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * «اپلای با کارجو» — برای همه نمایش داده می‌شود. مهمان به ورود می‌رود؛ کاربرِ
 * واردشده‌ای که هنوز به آن سایت وصل نیست به صفحه‌ی اتصال.
 */
function ApplyAction({
  job,
  isAuthenticated,
  currentHref,
}: {
  job: UnifiedJobRow;
  isAuthenticated: boolean;
  currentHref: string;
}) {
  if (!isAuthenticated) {
    return (
      <ButtonLink href="/login" size="sm">
        <IconSend className="h-4 w-4" />
        اپلای با کارجو
      </ButtonLink>
    );
  }
  if (job.alreadyApplied) {
    return (
      <span className="inline-flex items-center justify-center rounded-xl border border-jade/20 bg-jade/10 px-4 py-2 text-sm font-semibold text-jade">
        قبلاً اپلای شده
      </span>
    );
  }
  if (job.accountStatus !== "connected") {
    return (
      <ButtonLink href="/dashboard/extension" variant="secondary" size="sm">
        <IconPlug className="h-4 w-4" />
        برای اپلای، {siteLabel(job.board, job.providerName)} را وصل کن
      </ButtonLink>
    );
  }
  return (
    <form action={queueJobApplyAction}>
      <input type="hidden" name="listingId" value={job.id} />
      <input type="hidden" name="returnTo" value={currentHref} />
      <button className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition-transform active:translate-y-px">
        <IconSend className="h-4 w-4" />
        اپلای با کارجو
      </button>
    </form>
  );
}

function JobPagination({ base, state, pageCount }: { base: string; state: ParsedJobsQuery; pageCount: number }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="صفحه‌ها" className="flex flex-wrap items-center justify-center gap-2">
      {state.page > 1 ? (
        <ButtonLink href={jobsHref(base, state, { page: state.page - 1 })} variant="secondary" size="sm">
          صفحه‌ی قبل
        </ButtonLink>
      ) : null}
      <Badge tone="muted">
        {toFaDigits(state.page)} / {toFaDigits(pageCount)}
      </Badge>
      {state.page < pageCount ? (
        <ButtonLink href={jobsHref(base, state, { page: state.page + 1 })} variant="secondary" size="sm">
          صفحه‌ی بعد
        </ButtonLink>
      ) : null}
    </nav>
  );
}

/** فیلترهای شخصیِ کاربرِ واردشده — کنارِ فرمِ یکپارچه. */
export function PersonalJobFilters({ state, full = false }: { state: ParsedJobsQuery; full?: boolean }) {
  const control = "h-10 rounded-xl border border-border bg-surface px-3 text-sm outline-none";
  return (
    <>
      <select name="applied" defaultValue={state.applied} aria-label="وضعیتِ اپلای" className={control}>
        <option value="all">همه‌ی آگهی‌ها</option>
        <option value="not_applied">فقط اپلای‌نشده‌ها</option>
        <option value="applied">فقط اپلای‌شده‌ها</option>
      </select>
      {full ? (
        <>
          <select name="status" defaultValue={state.status ?? ""} aria-label="وضعیتِ تطبیق" className={control}>
            <option value="">همه‌ی تطبیق‌ها</option>
            {JOB_MATCH_STATUSES.map((status) => (
              <option key={status} value={status}>
                {MATCH_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={state.sort} aria-label="مرتب‌سازی" className={control}>
            {JOB_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </>
  );
}

const MATCH_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظارِ امتیاز",
  scored: "امتیازدهی‌شده",
  drafted: "رزومه آماده است",
  queued: "در صفِ اپلای",
  dismissed: "کنار گذاشته‌شده",
};

const SORT_LABELS: Record<string, string> = {
  newest: "جدیدترین",
  score: "بیشترین تطبیق",
  company: "نامِ شرکت",
  provider: "سایت",
};

const PROVIDER_STATUS_LABELS: Record<string, string> = {
  pending: "در انتظارِ بررسی",
  review: "در حالِ بررسی",
  interview: "مصاحبه",
  hired: "استخدام",
  rejected: "رد شده",
  other: "وضعیتِ دیگر",
};

/** وضعیتِ شخصیِ کاربر برای این آگهی، یا null اگر چیزی ثبت نشده. */
function personalStatusLabel(job: UnifiedJobRow): string | null {
  if (job.providerStatus) return PROVIDER_STATUS_LABELS[job.providerStatus] ?? "اپلای‌شده";
  if (job.applicationStatus === "submitted") return "ارسال‌شده";
  if (job.applicationStatus === "draft" || job.applicationStatus === "verifying") return "در حالِ آماده‌سازی";
  if (job.applicationStatus === "failed") return "ارسال ناموفق";
  if (job.matchStatus && job.matchStatus !== "pending") return MATCH_STATUS_LABELS[job.matchStatus] ?? null;
  return null;
}

export function JobResultNote({ result }: { result: string | undefined }) {
  const map: Record<string, { tone: "success" | "warn" | "danger" | "info"; text: string }> = {
    queued: { tone: "success", text: "درخواست ثبت شد؛ کارجو رزومه‌ی متناسب را می‌سازد و اپلای می‌کند." },
    already_queued: { tone: "info", text: "این آگهی از قبل در صفِ اپلای بود." },
    duplicate: { tone: "warn", text: "برای این آگهی قبلاً اپلای شده است." },
    connect: { tone: "warn", text: "برای اپلای، اول حسابت در همان سایت را از صفحه‌ی اتصال وصل کن." },
    provider: { tone: "warn", text: "اپلای در این سایت فعلاً ممکن نیست." },
    stale: { tone: "warn", text: "این آگهی قدیمی شده و دیگر اپلای نمی‌شود." },
    missing: { tone: "danger", text: "آگهی پیدا نشد یا دیگر در دسترس نیست." },
    dismissed: { tone: "warn", text: "این آگهی را قبلاً کنار گذاشته بودی." },
    invalid: { tone: "danger", text: "درخواست معتبر نبود؛ دوباره امتحان کن." },
  };
  const item = result ? map[result] : null;
  if (!item) return null;
  return (
    <Callout tone={item.tone} icon={<IconBolt />}>
      {item.text}
    </Callout>
  );
}

export function JobListSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-6 w-32 rounded-full" />
      {Array.from({ length: 5 }).map((_, index) => (
        <SkeletonCard key={index} className="h-32" />
      ))}
    </div>
  );
}

function formatFaDate(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(date);
}
