/**
 * نمای ادمینِ «سرورهای اپلای» (Server component) — Track C.
 *
 * این صفحه *ادمینی* است (نه کاربری) و با نگهبانِ ادمین (`isDashboardAdmin`) محافظت
 * می‌شود: ایمیلِ راستی‌آزمایی‌شده‌ی نشست باید در allowlistِ ادمین‌ها باشد.
 *
 * اصلاحِ افشا: نسخه‌ی قبلی به غیرِادمین یک کارتِ «دسترسیِ ادمین لازم است» نشان می‌داد و
 * حتی توضیح می‌داد که باید کوکیِ ادمین را با رازِ داخلیِ سرور ست کند — یعنی هم وجودِ
 * بخش را لو می‌داد هم مکانیزمش را. حالا برای غیرِادمین این مسیر ساده «وجود ندارد» (۴۰۴).
 *
 * الگوی Next 16: پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط محتوا می‌دهد و
 * containerِ محلی ندارد (بالشتک/عرض را layout مدیریت می‌کند). فهرستِ نودها داخلِ Suspense با
 * اسکلتِ هم‌شکلِ کارت‌های نود استریم می‌شود؛ کنترل‌ها از server actionهای محافظت‌شده می‌آیند.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, SkeletonList } from "@/components/dashboard/ui";
import { FleetAdminTable } from "@/components/dashboard/fleet-admin-table";
import { listFleetNodes } from "@/components/dashboard/fleet-admin-data";
import { isDashboardAdmin } from "@/components/dashboard/admin-guard";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "سرورهای اپلای",
  robots: { index: false, follow: false },
};

export default async function FleetAdminPage() {
  if (!(await isDashboardAdmin())) notFound();

  return (
    <div className="space-y-8">
      <PageHeader
        title="سرورهای اپلای"
        subtitle="سلامت و نسخه‌ی هر سرور، کاربرانِ تخصیص‌یافته به آن، و فرمان‌های به‌روزرسانی/ری‌استارت."
      />

      <Suspense fallback={<SkeletonList rows={3} />}>
        <NodesSection />
      </Suspense>
    </div>
  );
}

async function NodesSection() {
  const nodes = await listFleetNodes();
  return <FleetAdminTable nodes={nodes} />;
}
