/**
 * نمای «اپلای خودکار» (server component) — gate شده با نشست. Track A.
 *
 * این صفحه رضایتِ صریحِ کاربر برای اپلای خودکار را مدیریت می‌کند (§۱۰ گاردِ ۱):
 *   • تاگلِ رضایت (پیش‌فرض خاموش) + اسلایدرِ آستانه‌ی امتیاز،
 *   • مصرفِ اپلای امروز نسبت به سقفِ پلن،
 *   • آمادگیِ حساب‌های متصل (وضعیت + آمادگیِ مشخصاتِ اپلای)،
 *   • و ردِ ممیزیِ شفافِ رویدادهای اخیرِ اپلای خودکار.
 *
 * داده مقید به userIdِ نشست (قاعده‌ی ۴) و مستقیم از DB/هسته خوانده می‌شود (الگوی RSC).
 * بخشِ وابسته به DB در Suspense است تا پوسته فوراً بیاید.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
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
import { SectionHeading, Skeleton } from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "اپلای خودکار",
  robots: { index: false, follow: false },
};

export default async function AutoApplyPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="auto-apply">
      <SectionHeading
        title="اپلای خودکار"
        subtitle="با رضایتِ شما، کارجو فرصت‌های بالاتر از آستانه را در محدوده‌ی سقفِ روزانه به‌صورت خودکار اپلای می‌کند. این گزینه پیش‌فرض خاموش است و هر زمان قابلِ لغو است."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* ستونِ اصلی: کنترلِ تاگل/آستانه + ردِ ممیزی */}
        <div className="space-y-6 lg:col-span-2">
          <Suspense fallback={<Skeleton className="h-72" />}>
            <ToggleSection userId={user.userId} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-48" />}>
            <AuditSection userId={user.userId} />
          </Suspense>
        </div>

        {/* ستونِ کناری: مصرفِ امروز + وضعیتِ کارگرِ سرور + آمادگیِ سایت‌ها */}
        <div className="space-y-6">
          <Suspense fallback={<Skeleton className="h-40" />}>
            <UsageSection userId={user.userId} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-56" />}>
            <FleetSection userId={user.userId} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-40" />}>
            <BoardsSection userId={user.userId} />
          </Suspense>
        </div>
      </div>
    </DashboardShell>
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
  // وضعیتِ اپلای خودکارِ کارگرِ سرور (Max/Max+ فعال؛ Free/Pro دعوت به ارتقا).
  const data = await getFleetStatusData(userId);
  return <FleetStatusPanel data={data} />;
}
