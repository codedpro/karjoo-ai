/**
 * صفحه‌ی «اپلای‌ها» (Server component) — قیفِ تحلیلیِ درخواست‌های اپلایِ کاربر در جابینجا.
 *
 * منبعِ داده: `getApplications(userId, "jobinja")` از storeِ فاز ۲ (فقط-خواندنی، مقید به کاربر).
 * چیدمانِ Next 16: پوسته/هدر در `dashboard/layout.tsx` فوری است؛ این صفحه فقط محتوا می‌دهد و
 * هدرِ استاتیکِ خودش (`PageHeader` + دکمه‌ی همگام‌سازی) را بی‌درنگ می‌آورد. بخشِ وابسته به DB
 * داخلِ `<Suspense>` با اسکلتِ هم‌شکلِ محتوا استریم می‌شود. مقید به نشست (قاعده‌ی ۴). فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { JobinjaSyncButton } from "@/components/dashboard/jobinja-sync-button";
import { IconSend } from "@/components/dashboard/icons";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonList,
  cn,
  toFaDigits,
} from "@/components/dashboard/ui";
import {
  getApplications,
  type ApplicationFunnel,
} from "@/lib/apply/boards/jobinja-read";
import type { BoardApplication } from "@/db/schema";

import { buildFunnelSegments, CATEGORY_META, type FunnelCategory } from "./funnel";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (استریم با Suspense؛ بدونِ force-dynamic).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اپلای‌ها",
  robots: { index: false, follow: false },
};

export default async function ApplicationsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="اپلای‌های شما"
        subtitle="قیفِ درخواست‌هایت در جابینجا — از ارسال تا مصاحبه. با «به‌روزرسانی از جابینجا» تازه‌ترین وضعیتِ هر درخواست از حسابت خوانده می‌شود."
        actions={<JobinjaSyncButton label="به‌روزرسانی از جابینجا" />}
      />

      <Suspense fallback={<ApplicationsSkeleton />}>
        <ApplicationsSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ApplicationsSection({ userId }: { userId: string }) {
  const { funnel, items } = await getApplications(userId, "jobinja");

  if (funnel.total === 0) {
    return (
      <EmptyState
        icon={<IconSend />}
        title="هنوز اپلایی ثبت نشده"
        body="وقتی جابینجا را از افزونه وصل کنی و اپلای خودکار کار کند، درخواست‌هایت این‌جا فهرست می‌شوند و در یک قیف — در انتظار، بررسی، مصاحبه، رد — دیده می‌شوند."
        action={
          <ButtonLink href="/dashboard/matches" variant="secondary" size="sm">
            اتصالِ جابینجا و مشاهده‌ی تطبیق‌ها
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      <FunnelSummary funnel={funnel} />
      <ApplicationsList items={items} />
    </div>
  );
}

/* ─────────────────────────────  قیفِ خلاصه  ─────────────────────────────── */

/** کارت‌های آمارِ بالای صفحه: کل + چهار دسته‌ی اصلی، هرکدام با رنگِ لحنِ خودش. */
const SUMMARY_CATEGORIES: FunnelCategory[] = ["pending", "review", "interview", "rejected"];

function FunnelSummary({ funnel }: { funnel: ApplicationFunnel }) {
  const segments = buildFunnelSegments(funnel);
  const barSegments = segments.filter((s) => s.count > 0);

  return (
    <section aria-label="قیفِ اپلای" className="space-y-5">
      {/* کارت‌های شمارش */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCell value={funnel.total} label="کلِ اپلای‌ها" textClass="text-brand" />
        {SUMMARY_CATEGORIES.map((key) => (
          <StatCell
            key={key}
            value={funnel[key]}
            label={CATEGORY_META[key].label}
            textClass={CATEGORY_META[key].textClass}
          />
        ))}
      </div>

      {/* نوارِ نسبتیِ قیف + راهنما */}
      {barSegments.length > 0 ? (
        <div className="space-y-3">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-foreground/5"
            role="img"
            aria-label="نمودارِ نسبتِ وضعیت‌های اپلای"
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
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {barSegments.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-muted">
                <span className={cn("h-2.5 w-2.5 rounded-full", s.barClass)} aria-hidden />
                <span>{s.label}</span>
                <span className="ltr-nums font-semibold text-foreground">
                  {toFaDigits(s.count)}
                </span>
              </li>
            ))}
          </ul>
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

function ApplicationsList({ items }: { items: BoardApplication[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Badge tone="brand">
          <span className="ltr-nums tabular-nums">{toFaDigits(items.length)}</span>
          &nbsp;درخواست
        </Badge>
        <span className="text-pretty">تازه‌ترین اول</span>
      </div>
      <ol className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <ApplicationRow item={item} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** یک ردیفِ درخواست — عنوان/شرکت/تاریخ + نشانِ وضعیتِ رنگی؛ کلِ کارت لینک به آگهیِ جابینجا. */
function ApplicationRow({ item }: { item: BoardApplication }) {
  const meta = CATEGORY_META[item.statusCategory] ?? CATEGORY_META.other;
  const when = formatFaDate(item.appliedAt ?? item.lastSeenAt);

  const body = (
    <Card padded interactive={Boolean(item.url)} className="h-full">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">
            {item.title ?? "آگهیِ بدونِ عنوان"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {item.company ? <span className="truncate">{item.company}</span> : null}
            {when ? (
              <>
                {item.company ? <span aria-hidden>·</span> : null}
                <span className="ltr-nums">{when}</span>
              </>
            ) : null}
          </div>
        </div>
        <Badge tone={meta.tone} title={item.statusRaw ?? undefined}>
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
      className="focus-ring block rounded-2xl"
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
    <div className="space-y-8" aria-hidden>
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
      <Skeleton className="h-3 w-full rounded-full" />
      {/* فهرست */}
      <SkeletonList rows={4} />
    </div>
  );
}
