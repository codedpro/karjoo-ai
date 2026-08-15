/**
 * «وضعیتِ اپلای‌ها» (Server component) — همان صفحه‌ای که در ناوبری با پرسشِ «همین حالا چه
 * چیزی در حالِ ارسال است؟» معرفی می‌شود.
 *
 * نامِ قدیمِ این صفحه «آمادگی مصاحبه» بود که با کاری که می‌کند نمی‌خواند: این‌جا *وضعیتِ
 * ارسالِ* هر آگهی است (در نوبت، در حالِ ارسال، ارسال‌شده، ناموفق) به‌همراهِ متنِ آگهی،
 * رزومه‌ای که فرستاده شده و امکانِ تلاشِ دوباره. عنوان/متادیتا با همان نامِ ناوبری یکی شد.
 *
 * الگوی Next 16: پوسته در `layout.tsx` است و این صفحه فقط محتوا می‌دهد (بدونِ کانتینرِ
 * عرضِ خودش). کوئریِ سنگینِ فهرست داخلِ `<Suspense>` استریم می‌شود تا هدرِ صفحه بی‌درنگ
 * بیاید؛ اسکلت هم‌شکلِ محتوای واقعی است (نوارِ فیلتر + قابِ جدول) تا پرشِ چیدمان ندهد.
 * داده مقید به userIdِ نشست (قاعده‌ی ۴).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { InterviewPrepTable } from "@/components/dashboard/interview-prep-table";
import { getDashboardUser } from "@/components/dashboard/session";
import { PageHeader, Skeleton, SkeletonTable } from "@/components/dashboard/ui";
import { getInterviewPrepData } from "@/lib/apply/interview-prep";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "وضعیتِ اپلای‌ها",
  robots: { index: false, follow: false },
};

export default async function ApplyStatusPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="وضعیتِ اپلای‌ها"
        subtitle="هر آگهی که برایت فرستاده شده یا در نوبتِ ارسال است، با نتیجه‌اش."
      />
      <Suspense fallback={<ApplyStatusSkeleton />}>
        <ApplyStatusSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ApplyStatusSection({ userId }: { userId: string }) {
  const data = await getInterviewPrepData(userId, { limit: 1500 });
  return <InterviewPrepTable data={data} />;
}

/* ───────────────────── اسکلتِ هم‌شکل (نوارِ فیلتر + جدول) ───────────────────── */

function ApplyStatusSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-10 w-full rounded-xl lg:max-w-sm" />
        </div>
        <Skeleton className="mt-3 h-3.5 w-56" />
      </div>
      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
