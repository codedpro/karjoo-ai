/**
 * اسکلتِ سطحِ سگمنتِ /dashboard — هنگامِ ناوبری/تازه‌سازی نمایش داده می‌شود.
 *
 * پوسته (هدر/ناوبری) در `layout.tsx` استاتیک است و همان‌جا می‌مانَد؛ پس این loading فقط
 * ناحیه‌ی **محتوا** را پر می‌کند (نه کلِ صفحه، نه اسپینرِ تمام‌صفحه). هم‌شکلِ خانه‌ی
 * داشبورد است: ردیفِ کارت‌های آمار + دو ستونِ فهرست/پنل.
 */
import {
  SkeletonList,
  SkeletonStat,
} from "@/components/dashboard/ui";

export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-hidden>
      {/* عنوان + کارت‌های آمار */}
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="skeleton-shimmer h-8 w-64 rounded-lg bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-4 w-80 max-w-full rounded bg-foreground/[0.06]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      </div>

      {/* دو ستون: فهرستِ تطبیق + پنلِ کناری */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="skeleton-shimmer mb-4 h-6 w-40 rounded bg-foreground/[0.06]" />
          <SkeletonList rows={3} />
        </div>
        <div className="skeleton-shimmer h-64 rounded-2xl bg-foreground/[0.06]" />
      </div>
    </div>
  );
}
