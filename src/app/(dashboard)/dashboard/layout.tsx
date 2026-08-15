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
    <div className="min-h-dvh bg-surface">
      <JobinjaAutoSync />
      {/* ───────────────────── هدرِ چسبانِ استاتیک ───────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="dash-container flex h-16 items-center justify-between gap-4">
          {/* برند */}
          <Link
            href="/dashboard"
            className="focus-ring flex items-center gap-2.5 rounded-lg"
            aria-label="کارجو — داشبورد"
          >
            {/* روی موبایل فقط نشان؛ روی sm به‌بالا قفلِ کامل. */}
            <span className="sm:hidden">
              <Logo variant="mark" size={36} title="" className="text-foreground" />
            </span>
            <span className="hidden sm:inline-flex">
              <Logo size={32} title="" className="text-foreground" />
            </span>
            <span className="hidden rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-muted md:inline">
              داشبورد
            </span>
          </Link>

          {/* چیپِ کاربر (استریم) + خروج */}
          <div className="flex items-center gap-3">
            <Suspense fallback={<DashboardUserChipSkeleton />}>
              <DashboardUserChip />
            </Suspense>

            <form action={signOut}>
              <button
                type="submit"
                className="focus-ring rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-foreground/20 hover:text-foreground"
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
