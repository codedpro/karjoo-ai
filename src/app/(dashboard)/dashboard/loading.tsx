/**
 * اسکلتِ بارگذاریِ سطحِ سگمنتِ /dashboard — هنگامِ ناوبری/تازه‌سازی نمایش داده می‌شود.
 * شِل را تقلید نمی‌کند (loading کلِ سگمنت را جایگزین می‌کند) و سبک می‌ماند.
 */
import { Skeleton } from "@/components/dashboard/ui";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <Skeleton className="h-16 w-full" />
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
        <Skeleton className="h-52" />
      </div>
    </div>
  );
}
