/**
 * نمای «پلن‌ها و ارتقا» (server component) — gate شده با نشست. Track A.
 *
 * چهار لایه‌ی قیمتِ کارجو (رایگان/حرفه‌ای/مکس/مکس‌پلاس) را به‌صورتِ کارت (RTL/فارسی)
 * نشان می‌دهد: قیمت به تومان، اعتبارِ ماهانه‌ی هوش مصنوعی، سهمیه‌ی اپلای، تعدادِ IPِ
 * کارگر و تماسِ مستقیم. پلنِ فعلیِ کاربر برجسته می‌شود و هر پلنِ دیگر CTAِ ارتقا/تغییر
 * دارد که به POST /api/me/plan می‌رود.
 *
 * داده مستقیم از منبعِ حقیقتِ کد (`PLAN_LIST`) و وضعیتِ کاربر مقید به userIdِ نشست
 * (قاعده‌ی ۴) خوانده می‌شود. بخشِ وابسته به DB در Suspense است تا پوسته فوراً بیاید.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDashboardUser } from "@/components/dashboard/session";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { PlanStatusPanel } from "@/components/dashboard/plan-status-panel";
import { PlansGrid } from "@/components/dashboard/plans-grid";
import { SectionHeading, Skeleton } from "@/components/dashboard/ui";
import { PLAN_LIST } from "@/lib/billing/plans";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "پلن‌ها و ارتقا",
  robots: { index: false, follow: false },
};

export default async function PlansPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="plans">
      <SectionHeading
        title="پلن‌ها و ارتقا"
        subtitle="پلنِ مناسبِ خود را انتخاب کنید. اعتبارِ ماهانه‌ی هوش مصنوعی هر پلن به کیف‌پولِ شما اضافه می‌شود و هر فراخوانیِ هوش مصنوعی به‌میزانِ مصرف از همان موجودی کسر می‌شود. قابلیت‌های غیر-هوش‌مصنوعی (اپلای، استخراجِ متن، ایمپورت) در همه‌ی پلن‌ها در دسترس‌اند."
      />

      {/* خلاصه‌ی وضعیتِ فعلیِ کاربر (موجودی/گرنت/اپلای) */}
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-28" />}>
          <StatusSection userId={user.userId} />
        </Suspense>
      </div>

      {/* شبکه‌ی کارت‌های پلن + CTAِ ارتقا */}
      <div className="mt-8">
        <Suspense fallback={<GridSkeleton />}>
          <GridSection userId={user.userId} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function StatusSection({ userId }: { userId: string }) {
  const status = await getUserPlanStatus(userId);
  return <PlanStatusPanel status={status} />;
}

async function GridSection({ userId }: { userId: string }) {
  const status = await getUserPlanStatus(userId);
  return <PlansGrid plans={PLAN_LIST} currentPlan={status.planKey} />;
}

function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
      <Skeleton className="h-96" />
    </div>
  );
}
