/**
 * خانه‌ی داشبورد (Server component) — الگوی مرجعِ همه‌ی صفحه‌های داشبورد.
 *
 * الگوی Next 16 که این صفحه نشان می‌دهد:
 *   • پوسته (هدر/ناوبری) در `dashboard/layout.tsx` استاتیک و فوری است — این صفحه فقط
 *     محتوا می‌دهد (دیگر `<DashboardShell>` لازم نیست).
 *   • حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط `userId` را
 *     می‌گیریم (راستی‌آزماییِ کامل در session/چیپِ کاربر است).
 *   • هر بخشِ وابسته به DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود
 *     (کارت‌های آمار → SkeletonStat، فهرستِ تطبیق → SkeletonList) — نه بلاکِ خاکستریِ کلی.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AiMaintenanceBanner } from "@/components/dashboard/ai-maintenance-banner";
import {
  getDashboardCounts,
  getMatchesForUser,
  getProfileForUser,
} from "@/components/dashboard/data";
import { MatchCard } from "@/components/dashboard/match-card";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  IconCheck,
  IconHand,
  IconSend,
  IconTarget,
} from "@/components/dashboard/icons";
import {
  ButtonLink,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonList,
  SkeletonStat,
  StatCard,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "داشبورد",
  robots: { index: false, follow: false },
};

export default async function DashboardHomePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;
  const fallbackName = user.fullName ?? user.name;

  return (
    <div className="space-y-8">
      {/* بنرِ نگه‌داریِ هوش مصنوعی — فقط در حالتِ نگه‌داری دیده می‌شود. */}
      <div className="empty:hidden">
        <AiMaintenanceBanner />
      </div>

      {/* چک‌لیستِ «شروعِ کار» — استریم؛ اگر همه‌ی گام‌ها کامل باشد چیزی رندر نمی‌شود. */}
      <Suspense fallback={<Skeleton className="h-28 w-full rounded-2xl" />}>
        <OnboardingChecklist userId={userId} />
      </Suspense>

      {/* خوشامد + کارت‌های آمار (استریم؛ اسکلتِ هم‌شکلِ StatCard) */}
      <section>
        <Suspense fallback={<WelcomeSkeleton />}>
          <Welcome userId={userId} fallbackName={fallbackName} />
        </Suspense>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* بهترین تطبیق‌ها */}
        <section className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">بهترین تطبیق‌های شما</h2>
            <ButtonLink href="/dashboard/matches" variant="ghost" size="sm">
              مشاهده‌ی همه
            </ButtonLink>
          </div>
          <Suspense fallback={<SkeletonList rows={3} />}>
            <TopMatches userId={userId} />
          </Suspense>
        </section>

        {/* اتصالِ افزونه */}
        <aside className="space-y-6">
          <PairExtensionPanel />
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function Welcome({
  userId,
  fallbackName,
}: {
  userId: string;
  fallbackName: string | null;
}) {
  const [profile, counts] = await Promise.all([
    getProfileForUser(userId),
    getDashboardCounts(userId),
  ]);

  const name = profile?.fullName ?? fallbackName ?? "کاربر کارجو";

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <IconHand className="h-6 w-6 text-amber-500" />
            سلام، <span className="text-brand">{name}</span>
          </span>
        }
        subtitle="آخرین وضعیتِ تطبیق‌ها و اپلای‌هایت را این‌جا دنبال کن."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<IconCheck className="h-5 w-5" />}
          value={counts.drafted}
          label="تطبیقِ آماده‌ی اپلای"
          tone="brand"
        />
        <StatCard
          icon={<IconTarget className="h-5 w-5" />}
          value={counts.totalMatches}
          label="تطبیق‌های بررسی‌شده"
          tone="accent"
          href="/dashboard/matches"
        />
        <StatCard
          icon={<IconSend className="h-5 w-5" />}
          value={counts.totalApplications}
          label="اپلای‌های ثبت‌شده"
          tone="muted"
          href="/dashboard/applications"
        />
      </div>
    </div>
  );
}

async function TopMatches({ userId }: { userId: string }) {
  const matches = await getMatchesForUser(userId, 4);

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={<IconTarget className="h-7 w-7 text-brand" />}
        title="هنوز تطبیقی نداریم"
        body="فیلترهای اپلای را تنظیم کن و «جست‌وجوی مشاغل» را بزن تا فرصت‌های تازه پیدا و به صفِ اپلای اضافه شوند."
        action={
          <ButtonLink href="/dashboard/apply-filters">
            تنظیمِ فیلتر و جست‌وجوی مشاغل
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
    </div>
  );
}

/* ─────────────────────────── اسکلتِ خوشامد (هم‌شکل) ─────────────────────────── */

function WelcomeSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <div className="skeleton-shimmer h-8 w-64 rounded-lg bg-foreground/[0.06]" />
        <div className="skeleton-shimmer h-4 w-80 max-w-full rounded bg-foreground/[0.06]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
    </div>
  );
}
