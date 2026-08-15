/**
 * «پرونده‌ی جابینجا» (Server component) — آینه‌ی چیزی که *خودِ سایتِ کارفرما* گزارش می‌کند.
 *
 * مرزِ این صفحه با دو صفحه‌ی تاریخچه‌ی دیگر عمداً در خودِ متن آمده تا کسی نپرسد «چرا سه
 * صفحه؟»: بایگانیِ ارسال‌ها = چه فرستادیم و با کدام رزومه؛ وضعیتِ اپلای‌ها = همین حالا چه
 * چیزی در حالِ ارسال است؛ این‌جا = کارفرما درخواست را در چه مرحله‌ای دیده.
 *
 * دو تصمیمِ آرام‌سازی: (۱) نوارِ ابزار تا وقتی فهرست کوچک است اصلاً نمایش داده نمی‌شود و
 * مرتب‌سازی/جست‌وجو داخلِ `<details>` جمع شده‌اند (toolbar.tsx). (۲) نشانِ وضعیت دیگر متنِ
 * خامِ جابینجا نیست؛ به مجموعه‌ی کوچکِ فارسیِ `CATEGORY_META` نگاشت می‌شود و عبارتِ دقیقِ سایت
 * روی `title` می‌ماند.
 *
 * منبعِ داده: `listApplicationsPage` (فقط-خواندنی، مقید به کاربر). بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ هم‌شکلِ محتوا استریم می‌شود. فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SquareArrowOutUpRight } from "lucide-react";

import { getDashboardUser } from "@/components/dashboard/session";
import { JobinjaSyncButton } from "@/components/dashboard/jobinja-sync-button";
import { IconArchive, IconBolt, IconSend } from "@/components/dashboard/icons";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonList,
  cn,
  toFaDigits,
} from "@/components/dashboard/ui";
import type { ApplicationFunnel } from "@/lib/apply/boards/jobinja-read";
import {
  listApplicationsPage,
  parseApplicationQuery,
  type ApplicationRow as ApplicationListRow,
} from "@/lib/apply/applications-query";

import { buildFunnelSegments, CATEGORY_META, type FunnelCategory } from "./funnel";
import {
  ActiveFilterNote,
  Pagination,
  StatusFilter,
  ToolbarDetails,
  type ToolbarState,
} from "./toolbar";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (استریم با Suspense؛ بدونِ force-dynamic).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "پرونده‌ی جابینجا",
  robots: { index: false, follow: false },
};

/**
 * از این تعداد به بالا، فیلتر/جست‌وجو واقعاً به‌درد می‌خورد. پایین‌تر از آن، نوارِ ابزار فقط
 * شلوغیِ بصری است و کاربر کلِ فهرست را در یک نگاه می‌بیند.
 */
const TOOLBAR_MIN_ITEMS = 8;

/** Next 16: `searchParams` یک Promise است و باید await شود. */
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  // پارامترهای خام → پرس‌وجوی معتبر (ورودیِ دستکاری‌شده‌ی URL به پیش‌فرض می‌افتد).
  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) flat[k] = Array.isArray(v) ? v[0] : v;
  const state = parseApplicationQuery(flat) as ToolbarState;

  return (
    <div className="space-y-6">
      <PageHeader
        title="پرونده‌ی جابینجا"
        subtitle="کارفرماها درخواست‌هایت را در چه مرحله‌ای دیده‌اند — همان چیزی که جابینجا در حسابِ خودت نشان می‌دهد."
        actions={<JobinjaSyncButton label="به‌روزرسانی از جابینجا" />}
      />

      <Callout
        icon={<IconArchive />}
        title="این وضعیت‌ها را جابینجا اعلام می‌کند، نه ما"
        action={
          <ButtonLink href="/dashboard/archive" variant="secondary" size="sm">
            بایگانیِ ارسال‌ها
          </ButtonLink>
        }
      >
        برای دیدنِ اینکه چه فرستادیم و با کدام رزومه، سراغِ «بایگانیِ ارسال‌ها» برو.
      </Callout>

      {/* کلیدِ Suspense شاملِ فیلترهاست تا با هر تغییرِ فیلتر، اسکلت دوباره نشان داده شود. */}
      <Suspense key={JSON.stringify(state)} fallback={<ApplicationsSkeleton />}>
        <ApplicationsSection userId={user.userId} state={state} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ApplicationsSection({ userId, state }: { userId: string; state: ToolbarState }) {
  const { funnel, items, filteredTotal, pageCount } = await listApplicationsPage(
    userId,
    "jobinja",
    state,
  );

  if (funnel.total === 0) {
    return (
      <EmptyState
        icon={<IconSend />}
        title="هنوز درخواستی در جابینجا ثبت نشده"
        body="وقتی اپلای خودکار روشن باشد و درخواستی فرستاده شود، وضعیتِ هرکدام — بررسی‌نشده، در حالِ بررسی، دعوت به مصاحبه یا رد — همین‌جا نشان داده می‌شود."
        action={
          <ButtonLink href="/dashboard/auto-apply" size="sm">
            <IconBolt className="h-4 w-4" />
            روشن‌کردنِ اپلای خودکار
          </ButtonLink>
        }
      />
    );
  }

  // نوارِ ابزار تا وقتی فهرست کوچک است پنهان می‌ماند — مگر خودِ کاربر فیلتری گذاشته باشد
  // (وگرنه فیلترِ فعالِ نامرئی، فهرستِ کوتاه را غیرقابلِ توضیح می‌کرد).
  const showToolbar =
    funnel.total >= TOOLBAR_MIN_ITEMS || Boolean(state.status) || Boolean(state.q);

  return (
    <div className="space-y-6">
      <FunnelSummary funnel={funnel} />

      {showToolbar ? (
        <section className="space-y-3" aria-label="فیلتر و مرتب‌سازی">
          <StatusFilter state={state} counts={funnel} />
          <ToolbarDetails state={state} />
          <ActiveFilterNote state={state} shown={filteredTotal} />
        </section>
      ) : null}

      <ApplicationsList items={items} sort={state.sort} />

      <Pagination state={state} pageCount={pageCount} filteredTotal={filteredTotal} />
    </div>
  );
}

/* ─────────────────────────────  قیفِ خلاصه  ─────────────────────────────── */

/** کارت‌های آمارِ بالای صفحه: کل + چهار دسته‌ی اصلی، هرکدام با رنگِ لحنِ خودش. */
const SUMMARY_CATEGORIES: FunnelCategory[] = ["pending", "review", "interview", "rejected"];

/**
 * کارت‌های شمارش + یک نوارِ نسبتیِ باریک.
 *
 * راهنمای رنگیِ زیرِ نوار حذف شد: همان اعداد و برچسب‌ها یک‌بار در کارت‌ها و یک‌بار در چیپ‌های
 * فیلتر تکرار می‌شدند؛ سه‌بار گفتنِ یک عدد صفحه را شلوغ می‌کند، نه گویا.
 */
function FunnelSummary({ funnel }: { funnel: ApplicationFunnel }) {
  const barSegments = buildFunnelSegments(funnel).filter((s) => s.count > 0);

  return (
    <section aria-label="خلاصه‌ی وضعیتِ درخواست‌ها" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCell value={funnel.total} label="کلِ درخواست‌ها" textClass="text-brand" />
        {SUMMARY_CATEGORIES.map((key) => (
          <StatCell
            key={key}
            value={funnel[key]}
            label={CATEGORY_META[key].label}
            textClass={CATEGORY_META[key].textClass}
          />
        ))}
      </div>

      {barSegments.length > 0 ? (
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/5"
          role="img"
          aria-label="نمودارِ نسبتِ وضعیت‌های درخواست"
        >
          {barSegments.map((s) => (
            <div
              key={s.key}
              className={cn("h-full", s.barClass)}
              style={{ width: `${s.pct}%` }}
              title={`${s.label}: ${toFaDigits(s.count)}`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** یک کارتِ شمارشِ ساده — عددِ بزرگِ رنگی + برچسبِ خنثی. */
function StatCell({
  value,
  label,
  textClass,
}: {
  value: number;
  label: string;
  textClass: string;
}) {
  return (
    <Card padded>
      <div className={cn("ltr-nums text-3xl font-extrabold leading-none", textClass)}>
        {toFaDigits(value)}
      </div>
      <div className="mt-2 text-pretty text-xs text-muted">{label}</div>
    </Card>
  );
}

/* ───────────────────────────  فهرستِ درخواست‌ها  ─────────────────────────── */

function ApplicationsList({ items, sort }: { items: ApplicationListRow[]; sort: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconSend />}
        title="با این فیلتر چیزی پیدا نشد"
        body="فیلترِ وضعیت یا عبارتِ جست‌وجو را عوض کن، یا فیلترها را بردار تا همه‌ی درخواست‌ها را ببینی."
        action={
          <ButtonLink href="/dashboard/applications" variant="secondary" size="sm">
            حذفِ فیلترها
          </ButtonLink>
        }
      />
    );
  }
  // در نمایشگرِ پهن دو ستون: ردیف‌ها کوتاه‌اند و یک ستونِ تنها، عرضِ صفحه را هدر می‌دهد.
  return (
    <ol className="grid gap-3 xl:grid-cols-2">
      {items.map((item) => (
        <li key={item.id}>
          <ApplicationRow item={item} sort={sort} />
        </li>
      ))}
    </ol>
  );
}

/** یک ردیفِ درخواست — عنوان/شرکت/تاریخ + نشانِ وضعیت؛ کلِ کارت لینکِ *خروجی* به جابینجاست. */
function ApplicationRow({ item, sort }: { item: ApplicationListRow; sort: string }) {
  const meta = CATEGORY_META[item.statusCategory] ?? CATEGORY_META.other;
  // تاریخِ ارسال از خودِ جابینجا می‌آید؛ `lastSeenAt` فقط زمانِ همگام‌سازیِ ماست و اگر
  // به‌جای آن نشان داده شود، همه‌ی درخواست‌ها «امروز» به‌نظر می‌رسند.
  const applied = formatFaDate(item.appliedAt);
  const posted = formatFaDate(item.postedAt);

  const body = (
    <Card padded interactive={Boolean(item.url)} className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">
              {item.title ?? "آگهیِ بدونِ عنوان"}
            </span>
            {/* نشانه‌ی «این لینک از سایت خارج می‌شود» — بدونِ آن، کارت مرموزانه تبِ تازه باز
                می‌کرد و کاربر فکر می‌کرد صفحه‌ی جزئیاتِ درونِ کارجو را می‌بیند. */}
            {item.url ? (
              <SquareArrowOutUpRight
                strokeWidth={1.75}
                className="h-3.5 w-3.5 shrink-0 text-muted"
                aria-hidden
              />
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {item.company ? <span className="truncate">{item.company}</span> : null}
            {applied ? (
              <>
                {item.company ? <span aria-hidden>·</span> : null}
                <span className={cn("ltr-nums", sort === "applied" && "font-semibold text-foreground")}>
                  ارسال: {applied}
                </span>
              </>
            ) : null}
            {posted ? (
              <>
                <span aria-hidden>·</span>
                <span className={cn("ltr-nums", sort === "posted" && "font-semibold text-foreground")}>
                  انتشارِ آگهی: {posted}
                </span>
              </>
            ) : null}
          </div>
        </div>
        {/* برچسبِ یکدستِ ما روی نشان می‌نشیند؛ عبارتِ دقیقِ خودِ جابینجا در tooltip می‌ماند. */}
        <Badge
          tone={meta.tone}
          title={item.statusRaw?.trim() ? `عبارتِ جابینجا: ${item.statusRaw.trim()}` : undefined}
        >
          {meta.label}
        </Badge>
      </div>
    </Card>
  );

  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${item.title ?? "آگهی"} — بازکردن در جابینجا (تبِ تازه)`}
      className="focus-ring block h-full rounded-2xl"
    >
      {body}
    </a>
  ) : (
    body
  );
}

/** تاریخِ شمسیِ خوانا (یا null اگر تاریخی نبود). */
const FA_DATE_FMT = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
function formatFaDate(d: Date | null): string | null {
  if (!d) return null;
  try {
    return FA_DATE_FMT.format(d);
  } catch {
    return null;
  }
}

/* ─────────────────────── اسکلتِ هم‌شکلِ محتوا ─────────────────────── */

function ApplicationsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* کارت‌های شمارش */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
          >
            <Skeleton className="h-8 w-12" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
      {/* نوارِ قیف */}
      <Skeleton className="h-2.5 w-full rounded-full" />
      {/* فهرست */}
      <SkeletonList rows={4} />
    </div>
  );
}
