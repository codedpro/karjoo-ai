/**
 * «فرصت‌های شغلی» (Server component) — فهرستِ آگهی‌هایی که با پروفایلِ کاربر جور درآمده‌اند.
 *
 * این صفحه یک کارِ دارد و همان یک کار را تمام‌عرض انجام می‌دهد. ستونِ کناریِ قبلی (هزینه‌ی
 * هوش مصنوعی، افزونه، حساب‌های متصل) حذف شد: حالا که همه‌ی صفحه‌ها از ناوبری در دسترس‌اند،
 * هر کدام از آن پنل‌ها خانه‌ی درستِ خودش را دارد (اعتبار و هزینه / افزونه‌ی مرورگر / اپلای
 * خودکار) و تکرارشان این‌جا فقط یک‌سومِ عرضِ فهرست را می‌خورد. کامپوننت‌هایشان دست‌نخورده‌اند؛
 * فقط این صفحه دیگر واردشان نمی‌کند.
 *
 * «بیشتر» به‌جای سقفِ خاموش: قبلاً فهرست روی ۵۰ تطبیق قطع می‌شد بدونِ هیچ نشانه‌ای. حالا
 * اندازه‌ی صفحه در خودِ URL است (`?limit=`) — قابلِ بوکمارک، بدونِ جاوااسکریپت، بدونِ state.
 *
 * الگوی Next 16: پوسته/هدر در `dashboard/layout.tsx` فوری است؛ خواندنِ DB داخلِ `<Suspense>`
 * با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getMatchesForUser } from "@/components/dashboard/data";
import { IconBolt, IconCompass, IconDoc } from "@/components/dashboard/icons";
import { MatchCard } from "@/components/dashboard/match-card";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  ButtonLink,
  Callout,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonCard,
  toFaDigits,
} from "@/components/dashboard/ui";
import { SectionTabs, APPLY_TABS } from "@/components/dashboard/section-tabs";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "فرصت‌های شغلی",
  robots: { index: false, follow: false },
};

/** گامِ «نمایشِ بیشتر» و سقفِ سختِ آن (بالاتر از این، فهرست دیگر خوانده نمی‌شود). */
const PAGE_STEP = 24;
const MAX_LIMIT = 240;

/** `?limit=` را به عددِ معتبرِ مضربِ گام تبدیل می‌کند (URLِ دستکاری‌شده → پیش‌فرض). */
function parseLimit(raw: string | string[] | undefined): number {
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""), 10);
  if (!Number.isFinite(value)) return PAGE_STEP;
  return Math.min(MAX_LIMIT, Math.max(PAGE_STEP, value));
}

/** Next 16: `searchParams` یک Promise است و باید await شود. */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const limit = parseLimit((await searchParams).limit);

  return (
    <div className="space-y-6">
      <PageHeader
        title="فرصت‌های شغلی"
        subtitle="آگهی‌هایی که هوش مصنوعی کارجو با پروفایلت سنجیده و مناسب دیده — بالاترین امتیاز اول."
              />
      <SectionTabs tabs={APPLY_TABS} active="/dashboard/matches" ariaLabel="زبانه‌های اپلای‌ها" />

      <Suspense key={limit} fallback={<MatchesSkeleton />}>
        <MatchesList userId={user.userId} limit={limit} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function MatchesList({ userId, limit }: { userId: string; limit: number }) {
  // یکی بیشتر می‌خوانیم تا بفهمیم «بیشتر»ی هست یا نه، بدونِ یک کوئریِ شمارشِ جداگانه.
  const rows = await getMatchesForUser(userId, limit + 1);
  const hasMore = rows.length > limit;
  const matches = hasMore ? rows.slice(0, limit) : rows;

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={<IconCompass />}
        title="هنوز فرصتی پیدا نشده"
        body="کارجو آگهی‌های تازه را با پروفایلت می‌سنجد. هرچه رزومه‌ات کامل‌تر باشد و اپلای خودکار روشن باشد، سریع‌تر نتیجه می‌گیری."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ButtonLink href="/dashboard/profiles" size="sm">
              <IconDoc className="h-4 w-4" />
              تکمیلِ رزومه و پروفایل
            </ButtonLink>
            <ButtonLink href="/dashboard/auto-apply" variant="secondary" size="sm">
              <IconBolt className="h-4 w-4" />
              تنظیمِ اپلای خودکار
            </ButtonLink>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Badge tone="brand">
          <span className="ltr-nums tabular-nums">{toFaDigits(matches.length)}</span>
          &nbsp;فرصت
        </Badge>
        <span className="text-pretty">به‌ترتیبِ بالاترین امتیاز</span>
      </div>

      {/* عرضِ سیالِ پوسته را پر می‌کنیم: در نمایشگرِ بزرگ سه ستون، در متوسط دو ستون. */}
      <ol className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {matches.map((m) => (
          <li key={m.id}>
            <MatchCard match={m} />
          </li>
        ))}
      </ol>

      {hasMore ? (
        <div className="flex justify-center">
          <ButtonLink
            href={`/dashboard/matches?limit=${Math.min(MAX_LIMIT, limit + PAGE_STEP)}`}
            variant="secondary"
            size="md"
          >
            نمایشِ فرصت‌های بیشتر
          </ButtonLink>
        </div>
      ) : limit > PAGE_STEP ? (
        <Callout tone="info" icon={<IconCompass />}>
          همه‌ی فرصت‌های فعلی نشان داده شد.
        </Callout>
      ) : null}
    </div>
  );
}

/* ─────────────────────── اسکلتِ هم‌شکلِ محتوا ─────────────────────── */

/** هم‌شکلِ فهرست: چیپِ شمارش + شبکه‌ی کارت‌ها (نه یک ستونِ باریک). */
function MatchesSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-6 w-28 rounded-full" />
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
