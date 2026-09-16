/**
 * چیدمانِ سگمنتِ /dashboard — پوسته‌ی استاتیکِ **بی‌درنگِ** داشبورد (Server component).
 *
 * این layout یک‌بار رندر می‌شود و برای همه‌ی صفحه‌های `/dashboard/**` مشترک است (نه
 * برای /login که خارجِ این سگمنت است). ساختار:
 *   • هدرِ چسبانِ استاتیک: برند + چیپِ کاربر (استریم‌شونده) + دکمه‌ی خروج.
 *   • ناوبریِ کناریِ دسکتاپ (client، لینکِ فعال از مسیر).
 *   • ناوبریِ افقیِ موبایل + `<main>`ی که محتوای هر صفحه در آن می‌نشیند.
 *
 * نکته‌ی کلیدیِ الگوی Next 16 (پوسته‌ی فوری): هیچ `await getDashboardUser()` در بدنه‌ی
 * layout نیست؛ پس پوسته بدونِ منتظرماندن روی DB فوراً می‌آید. تنها چیپِ کاربر که به DB
 * وابسته است، داخلِ `<Suspense>` استریم می‌شود. دروازه‌بانیِ ارزانِ حضورِ نشست هم در
 * `proxy.ts` انجام می‌شود (لبه، بدونِ DB)؛ راستی‌آزماییِ کامل داخلِ همان چیپ و در
 * data-helperهای هر صفحه.
 */
import Link from "next/link";
import { Suspense } from "react";

import { AdminNavGroup } from "@/components/dashboard/admin-nav";
import {
  DashboardUserChip,
  DashboardUserChipSkeleton,
} from "@/components/dashboard/dashboard-user-chip";
import {
  DashboardWalletChip,
  DashboardWalletChipSkeleton,
} from "@/components/dashboard/dashboard-wallet-chip";
import { MobileNav, SidebarNav } from "@/components/dashboard/dashboard-nav";
import { JobinjaAutoSync } from "@/components/dashboard/jobinja-sync-button";
import { signOut } from "@/components/dashboard/actions";
import { Logo } from "@/components/brand/logo";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // پس‌زمینه از body (night-900) — همان صفحه‌ی 1xAi، تا دانه‌ی کاغذ رویش دیده شود.
    <div className="min-h-dvh">
      <JobinjaAutoSync />
      {/* ───────────────────── هدرِ چسبانِ استاتیک (topbarِ 1xAi) ───────────────────── */}
      <header className="sticky top-0 z-40 border-b border-hairline-soft bg-night-900/85 backdrop-blur-xl supports-backdrop-filter:bg-night-900/70">
        <div className="dash-container flex h-14 items-center justify-between gap-4">
          {/* برند */}
          <Link
            href="/dashboard"
            className="group focus-ring flex items-center gap-2.5"
            aria-label="کارجو — داشبورد"
          >
            {/* روی موبایل فقط نشان؛ روی sm به‌بالا قفلِ کامل. */}
            <span className="sm:hidden">
              <Logo variant="mark" size={32} title="" className="text-bone" />
            </span>
            <span className="hidden sm:inline-flex">
              <Logo size={30} title="" className="text-bone transition-colors group-hover:text-persimmon" />
            </span>
            <span className="hidden items-center gap-1.5 border-s border-hairline ps-2.5 text-xs text-bone-dim md:inline-flex">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-persimmon" />
              داشبورد
            </span>
          </Link>

          {/* چیپِ کاربر (استریم) + خروج */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Suspense fallback={<DashboardWalletChipSkeleton />}>
              <DashboardWalletChip />
            </Suspense>
            <Suspense fallback={<DashboardUserChipSkeleton />}>
              <DashboardUserChip />
            </Suspense>

            <form action={signOut}>
              <button
                type="submit"
                className="focus-ring press inline-flex h-9 items-center border border-hairline-strong px-3 text-sm text-bone-soft transition-colors hover:border-persimmon/40 hover:text-bone"
              >
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ───────────────────── بدنه: ناوبریِ کناری + محتوا ───────────────────── */}
      <div className="dash-container flex gap-6 py-6 lg:gap-8 lg:py-8">
        {/* ناوبریِ کناریِ دسکتاپ — روی نمایشگرِ بزرگ‌تر پهن‌تر می‌شود تا راهنمای
            یک‌خطیِ هر آیتم جا شود (`xl:block` در خودِ ناوبری). */}
        <aside className="hidden w-56 shrink-0 lg:block xl:w-64">
          <SidebarNav>
            {/* گروهِ «مدیریت» — سروری و استریم‌شونده؛ پوسته را بلاک نمی‌کند. */}
            <Suspense fallback={null}>
              <AdminNavGroup />
            </Suspense>
          </SidebarNav>
        </aside>

        {/* محتوای صفحه — بالشتک/عرض این‌جا مدیریت می‌شود؛ صفحه‌ها فقط محتوا می‌دهند. */}
        <main className="min-w-0 flex-1">
          {/* ناوبریِ موبایل: چیپ‌های اصلی + کشوی «همه‌ی بخش‌ها» (زیرِ lg) */}
          <div className="mb-6 lg:hidden">
            <MobileNav>
              <Suspense fallback={null}>
                <AdminNavGroup />
              </Suspense>
            </MobileNav>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
