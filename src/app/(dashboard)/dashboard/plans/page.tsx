/**
 * نمای «پلن‌ها و ارتقا» (Server component) — الگوی Next 16 (پوسته‌ی فوری + استریم).
 *
 * چهار لایه‌ی قیمتِ کارجو (رایگان/حرفه‌ای/مکس/مکس‌پلاس) را به‌صورتِ کارت (RTL/فارسی)
 * نشان می‌دهد: قیمت به تومان، اعتبارِ ماهانه‌ی هوش مصنوعی، سهمیه‌ی اپلای، تعدادِ IPِ
 * ورکر و تماسِ مستقیم. پلنِ فعلیِ کاربر برجسته می‌شود و هر پلنِ دیگر CTAِ ارتقا/تغییر
 * دارد که به POST /api/me/plan می‌رود.
 *
 * پوسته در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط محتوا می‌دهد. داده مستقیم
 * از منبعِ حقیقتِ کد (`PLAN_LIST`) و وضعیتِ کاربر مقید به userIdِ نشست (قاعده‌ی ۴) خوانده
 * می‌شود. بخش‌های وابسته به DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم
 * می‌شوند (نوارِ وضعیت + شبکه‌ی کارتِ پلن).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { PlanStatusPanel } from "@/components/dashboard/plan-status-panel";
import { PlansGrid } from "@/components/dashboard/plans-grid";
import { PageHeader, ButtonLink, Skeleton } from "@/components/dashboard/ui";
import { PLAN_LIST } from "@/lib/billing/plans";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (دیگر force-dynamic لازم نیست).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "پلن‌ها و ارتقا",
  robots: { index: false, follow: false },
};

export default async function PlansPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const { userId } = user;

  return (
    <div className="space-y-8">
      <PageHeader
        title="پلن‌ها و ارتقا"
        subtitle="پلن یعنی استحقاق: سهمیه‌ی اپلای، ورکرِ ۲۴/۷ و پشتیبانی. هوش مصنوعی در همه‌ی پلن‌ها به‌میزانِ مصرف و با نرخِ خودِ 1xAi از کیف‌پولِ واحدت کسر می‌شود (شارژ در 1xai). ارتقا قیمتِ پلن را همان لحظه از همان کیف‌پول کسر می‌کند."
        actions={
          <ButtonLink href="/dashboard/billing" variant="secondary" size="sm">
            کیف‌پول و صورتحساب
          </ButtonLink>
        }
      />

      {/* خلاصه‌ی وضعیتِ فعلیِ کاربر (پلن/موجودی/گرنت/اپلای) */}
      <Suspense fallback={<StatusSkeleton />}>
        <StatusSection userId={userId} />
      </Suspense>

      {/* شبکه‌ی کارت‌های پلن + CTAِ ارتقا */}
      <Suspense fallback={<GridSkeleton />}>
        <GridSection userId={userId} />
      </Suspense>
    </div>
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

/* ─────────────────── اسکلت‌های هم‌شکل (نوارِ وضعیت + شبکه‌ی پلن) ─────────────────── */

/** هم‌شکلِ PlanStatusPanel — یک کارت با چهار ستونِ متری. */
function StatusSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** هم‌شکلِ PlansGrid — چهار کارتِ پلن با قیمت/اعتبار/مشخصات/CTA. */
function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="mt-4 h-16 w-full rounded-xl" />
          <div className="mt-4 space-y-2.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="mt-6 h-11 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
