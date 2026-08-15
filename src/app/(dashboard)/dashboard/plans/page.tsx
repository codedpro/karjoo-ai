/**
 * «اشتراک» (Server component) — چهار لایه‌ی قیمتِ کارجو و ارتقا/تغییرِ پلن.
 *
 * زبان: زیرعنوانِ قبلی با «پلن یعنی استحقاق» شروع می‌شد (اصطلاحِ داخلیِ کد) و بعد همان
 * پاراگرافِ صفحه‌ی صورتحساب را تکرار می‌کرد. حالا یک جمله: اشتراک تعیین می‌کند چند اپلای در
 * روز و با چه امکاناتی. تفکیکِ نقشِ این صفحه از «اعتبار و هزینه» هم در یک یادداشتِ کوتاه آمده.
 *
 * کارایی: `StatusSection` و `GridSection` هر دو وضعیتِ پلن را لازم دارند و قبلاً هرکدام
 * `getUserPlanStatus` را جدا صدا می‌زدند — یعنی دو بار خواندنِ DB + دو بار تماس با کیف‌پولِ
 * 1xai در یک رندر. با `cache()`ِ React یک‌بار اجرا می‌شود و نتیجه در همان درخواست به اشتراک
 * گذاشته می‌شود؛ دو `<Suspense>`ِ مستقل هم حفظ می‌شوند (نوارِ وضعیت زودتر می‌آید).
 *
 * پوسته در `dashboard/layout.tsx` استاتیک است؛ داده مقید به userIdِ نشست (قاعده‌ی ۴).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { PlanStatusPanel } from "@/components/dashboard/plan-status-panel";
import { PlansGrid } from "@/components/dashboard/plans-grid";
import { IconWallet } from "@/components/dashboard/icons";
import { ButtonLink, Callout, PageHeader, Skeleton } from "@/components/dashboard/ui";
import { PLAN_LIST } from "@/lib/billing/plans";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (دیگر force-dynamic لازم نیست).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اشتراک",
  robots: { index: false, follow: false },
};

/**
 * وضعیتِ پلن، یک‌بار در هر درخواست. `cache` نتیجه را برای همه‌ی فراخوان‌های همان رندر
 * نگه می‌دارد؛ پس دو بخشِ Suspense روی یک خواندن سوارند.
 */
const planStatus = cache(getUserPlanStatus);

export default async function PlansPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const { userId } = user;

  return (
    <div className="space-y-6">
      <PageHeader
        title="اشتراک"
        subtitle="اشتراک تعیین می‌کند روزانه چند درخواست برایت فرستاده شود و چه امکاناتی داشته باشی."
      />

      <Callout
        icon={<IconWallet />}
        title="اشتراک با اعتبارِ کیف‌پول فرق دارد"
        action={
          <ButtonLink href="/dashboard/billing" variant="secondary" size="sm">
            اعتبار و هزینه
          </ButtonLink>
        }
      >
        هزینه‌ی پردازش‌های هوش مصنوعی جدا از اشتراک، به‌اندازه‌ی مصرف، از کیف‌پول کسر می‌شود.
      </Callout>

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
  const status = await planStatus(userId);
  return <PlanStatusPanel status={status} />;
}

async function GridSection({ userId }: { userId: string }) {
  const status = await planStatus(userId);
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

/** هم‌شکلِ PlansGrid — همان شبکه‌ی پاسخ‌گو (۱→۲→۴ ستون) با چهار کارتِ پلن. */
function GridSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4" aria-hidden>
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
