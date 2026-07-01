/**
 * نمای «اپلای خودکار» (Server component) — رضایتِ صریحِ کاربر برای اپلای خودکار (§۱۰ گاردِ ۱).
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط
 * محتوا می‌دهد و هدرِ استاتیکِ خودش را با `PageHeader` *بی‌درنگ* می‌آورد. حضورِ نشست پیش‌تر در
 * `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط `userId` را می‌گیریم. هر بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود (نه بلاکِ خاکستریِ کلی).
 *
 * چهار بخشِ کاربر: تاگل/آستانه، مصرفِ امروز، وضعیتِ سرورِ اپلای، آمادگیِ سایت‌ها، و ردِ ممیزی.
 * داده مقید به userIdِ نشست (قاعده‌ی ۴) و مستقیم از DB/هسته خوانده می‌شود (الگوی RSC).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getAutoApplyDashboardData } from "@/components/dashboard/auto-apply-data";
import { AutoApplyToggle } from "@/components/dashboard/auto-apply-toggle";
import {
  ApplyUsagePanel,
  AutoApplyAuditPanel,
  BoardReadinessPanel,
} from "@/components/dashboard/auto-apply-panels";
import { FleetStatusPanel } from "@/components/dashboard/fleet-status-panel";
import { getFleetStatusData } from "@/components/dashboard/fleet-status-data";
import {
  PageHeader,
  SkeletonCard,
  SkeletonList,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اپلای خودکار",
  robots: { index: false, follow: false },
};

export default async function AutoApplyPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;

  return (
    <div className="space-y-8">
      <PageHeader
        title="اپلای خودکار"
        subtitle="با رضایتِ شما، کارجو فرصت‌های بالاتر از آستانه را در محدوده‌ی سقفِ روزانه به‌صورت خودکار اپلای می‌کند. این گزینه پیش‌فرض خاموش است و هر لحظه قابلِ لغو است."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ستونِ اصلی: کنترلِ تاگل/آستانه + ردِ ممیزی */}
        <div className="space-y-6 lg:col-span-2">
          <Suspense fallback={<ToggleSkeleton />}>
            <ToggleSection userId={userId} />
          </Suspense>

          <Suspense fallback={<AuditSkeleton />}>
            <AuditSection userId={userId} />
          </Suspense>
        </div>

        {/* ستونِ کناری: مصرفِ امروز + وضعیتِ سرورِ اپلای + آمادگیِ سایت‌ها */}
        <div className="space-y-6">
          <Suspense fallback={<SkeletonCard className="h-40" />}>
            <UsageSection userId={userId} />
          </Suspense>
          <Suspense fallback={<SkeletonCard className="h-56" />}>
            <FleetSection userId={userId} />
          </Suspense>
          <Suspense fallback={<SkeletonCard className="h-44" />}>
            <BoardsSection userId={userId} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function ToggleSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return (
    <AutoApplyToggle
      initialEnabled={data.settings.enabled}
      initialMinScore={data.settings.minScore}
      hasReadyBoard={data.hasReadyBoard}
    />
  );
}

async function AuditSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <AutoApplyAuditPanel audit={data.audit} />;
}

async function UsageSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <ApplyUsagePanel apply={data.apply} />;
}

async function BoardsSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <BoardReadinessPanel boards={data.boards} />;
}

async function FleetSection({ userId }: { userId: string }) {
  // وضعیتِ اپلای خودکارِ سرورِ اپلای (Max/Max+ فعال؛ Free/Pro دعوت به ارتقا).
  const data = await getFleetStatusData(userId);
  return <FleetStatusPanel data={data} />;
}

/* ─────────────────── اسکلت‌های هم‌شکلِ محتوا (نه بلاکِ خالی) ─────────────────── */

/** اسکلتِ کارتِ تاگل — سرسطر + سوییچ + اسلایدر (هم‌شکلِ AutoApplyToggle). */
function ToggleSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2.5">
          <div className="skeleton-shimmer h-5 w-28 rounded-lg bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-full rounded bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-4/5 rounded bg-foreground/[0.06]" />
        </div>
        <div className="skeleton-shimmer h-7 w-12 shrink-0 rounded-full bg-foreground/[0.06]" />
      </div>
      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="flex items-center justify-between">
          <div className="skeleton-shimmer h-4 w-32 rounded bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-6 w-12 rounded-full bg-foreground/[0.06]" />
        </div>
        <div className="skeleton-shimmer mt-4 h-2 w-full rounded-full bg-foreground/[0.06]" />
      </div>
    </div>
  );
}

/** اسکلتِ ردِ ممیزی — چند ردیفِ رویداد (آیکن + متن + نشان). */
function AuditSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="skeleton-shimmer h-5 w-40 rounded-lg bg-foreground/[0.06]" />
      <div className="skeleton-shimmer mt-2 h-3.5 w-3/4 rounded bg-foreground/[0.06]" />
      <SkeletonList rows={3} className="mt-5" />
    </div>
  );
}
