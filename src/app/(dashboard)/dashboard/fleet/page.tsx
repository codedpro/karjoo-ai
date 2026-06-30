/**
 * نمای ادمینِ «ناوگانِ کارگر» (server component) — Track C.
 *
 * این صفحه *ادمینی* است (نه کاربری): با نگهبانِ ادمین (isFleetAdmin) محافظت می‌شود که رازِ
 * داخلیِ سرور (INTERNAL_API_SECRET) را سمتِ سرور با کوکیِ ادمین مقایسه می‌کند — راز هرگز به
 * کلاینت نشت نمی‌کند. اگر ادمین نباشد، یک پیامِ «دسترسی ندارید» نشان داده می‌شود (نه افشای
 * وجودِ بخش).
 *
 * فهرستِ نودها، کاربرانِ تخصیص‌یافته، و کنترل‌های تخصیص/حذف/صدورِ فرمان از طریقِ server
 * actionهای محافظت‌شده انجام می‌شوند. داده مستقیم از DB خوانده می‌شود (الگوی RSC).
 */
import type { Metadata } from "next";
import { Suspense } from "react";

import { SectionHeading, Skeleton } from "@/components/dashboard/ui";
import { FleetAdminTable } from "@/components/dashboard/fleet-admin-table";
import { listFleetNodes } from "@/components/dashboard/fleet-admin-data";
import { isFleetAdmin } from "@/components/dashboard/fleet-admin-guard";

// راستی‌آزماییِ کوکی + خواندنِ DB → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ناوگانِ کارگر (ادمین)",
  robots: { index: false, follow: false },
};

export default async function FleetAdminPage() {
  const admin = await isFleetAdmin();

  if (!admin) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-rose-500/10 text-3xl">
          🔒
        </div>
        <h1 className="mt-5 text-xl font-extrabold">دسترسیِ ادمین لازم است</h1>
        <p className="mt-2 text-sm leading-7 text-muted">
          این بخش فقط برای مدیرانِ ناوگان است. برای دسترسی، کوکیِ ادمین با رازِ داخلیِ سرور باید
          تنظیم شده باشد.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <SectionHeading
        title="ناوگانِ کارگر"
        subtitle="وضعیتِ نودهای کارگر (سلامت، نسخه، آخرین دیده‌شدن)، کاربرانِ تخصیص‌یافته، و کنترلِ تخصیص/حذف و صدورِ فرمانِ به‌روزرسانی/ری‌استارت. همه‌ی کنترل‌ها سمتِ سرور با رازِ داخلی محافظت می‌شوند."
      />

      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <NodesSection />
        </Suspense>
      </div>
    </div>
  );
}

async function NodesSection() {
  const nodes = await listFleetNodes();
  return <FleetAdminTable nodes={nodes} />;
}
