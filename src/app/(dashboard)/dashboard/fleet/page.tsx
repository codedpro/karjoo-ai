/**
 * نمای ادمینِ «ناوگانِ اپلای» (Server component) — Track C.
 *
 * این صفحه *ادمینی* است (نه کاربری): با نگهبانِ ادمین (isFleetAdmin) محافظت می‌شود که رازِ
 * داخلیِ سرور (INTERNAL_API_SECRET) را سمتِ سرور با کوکیِ ادمین مقایسه می‌کند — راز هرگز به
 * کلاینت نشت نمی‌کند. اگر ادمین نباشد، یک پیامِ «دسترسی ندارید» نشان داده می‌شود (نه افشای
 * وجودِ بخش).
 *
 * الگوی Next 16: پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط محتوا می‌دهد و
 * دیگر containerِ محلی ندارد (بالشتک/عرض را layout مدیریت می‌کند). فهرستِ نودها داخلِ Suspense با
 * اسکلتِ هم‌شکلِ کارت‌های نود استریم می‌شود؛ کنترل‌ها از server actionهای محافظت‌شده می‌آیند.
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { Card, PageHeader, SkeletonList } from "@/components/dashboard/ui";
import { IconLock } from "@/components/dashboard/icons";
import { FleetAdminTable } from "@/components/dashboard/fleet-admin-table";
import { listFleetNodes } from "@/components/dashboard/fleet-admin-data";
import { isFleetAdmin } from "@/components/dashboard/fleet-admin-guard";

// راستی‌آزماییِ کوکی + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ناوگانِ اپلای (ادمین)",
  robots: { index: false, follow: false },
};

export default async function FleetAdminPage() {
  const admin = await isFleetAdmin();

  if (!admin) {
    return (
      <Card padded className="mx-auto max-w-md text-center">
        <div className="flex flex-col items-center py-6">
          <span
            className="grid h-14 w-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400"
            aria-hidden
          >
            <IconLock className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-balance text-lg font-bold">
            دسترسیِ ادمین لازم است
          </h1>
          <p className="mt-2 max-w-sm text-pretty text-sm leading-7 text-muted">
            این بخش فقط برای مدیرانِ ناوگان است. برای دسترسی، کوکیِ ادمین باید با رازِ
            داخلیِ سرور تنظیم شده باشد.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="ناوگانِ اپلای"
        subtitle="وضعیتِ سرورهای اپلای (سلامت، نسخه، آخرین دیده‌شدن)، کاربرانِ تخصیص‌یافته، و کنترلِ تخصیص/حذف و صدورِ فرمانِ به‌روزرسانی/ری‌استارت. همه‌ی کنترل‌ها سمتِ سرور با رازِ داخلی محافظت می‌شوند."
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
