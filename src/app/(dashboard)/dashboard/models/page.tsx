/**
 * نمای «مدلِ هوش مصنوعی» (server component) — انتخابِ مدلِ پولیِ کاربر — Track A.
 *
 * gate شده با نشست. کاتالوگِ فعال و انتخابِ فعلیِ کاربر مستقیم از DB خوانده می‌شوند
 * (الگوی RSC، بدونِ round-trip به API)، سپس به مدل‌پیکرِ کلاینت پاس داده می‌شوند. ذخیره
 * از سمتِ کلاینت با PUT /api/ai-settings انجام می‌شود (که به نشستِ همین کاربر مقید است).
 *
 * این انتخاب تعیین می‌کند فراخوانی‌های پولیِ هوش مصنوعی (تطبیق/انگیزه‌نامه/استخراجِ رزومه)
 * با کدام مدل اجرا شوند و چه قیمتی (تومان) از کیف‌پول کسر شود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ModelPicker } from "@/components/dashboard/model-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { SectionHeading, Skeleton } from "@/components/dashboard/ui";
import {
  getEnabledCatalog,
  getUserModelSelection,
  groupByProvider,
  recommendedModelId,
} from "@/lib/ai-settings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "مدلِ هوش مصنوعی",
  robots: { index: false, follow: false },
};

export default async function ModelsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="models">
      <SectionHeading
        title="انتخابِ مدلِ هوش مصنوعی"
        subtitle="مدلی که می‌خواهید برای تطبیقِ شغل، نگارشِ انگیزه‌نامه و پردازشِ رزومه استفاده شود را انتخاب کنید. قیمت‌ها به تومان به‌ازای هر ۱۰۰۰ توکن است و از کیف‌پولِ شما کسر می‌شود."
      />

      <div className="mt-8">
        <Suspense fallback={<PickerSkeleton />}>
          <PickerSection userId={user.userId} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function PickerSection({ userId }: { userId: string }) {
  // کاتالوگ و انتخابِ کاربر را موازی بخوان.
  const [catalog, selection] = await Promise.all([
    getEnabledCatalog(),
    getUserModelSelection(userId),
  ]);

  return (
    <ModelPicker
      groups={groupByProvider(catalog)}
      initialSelectedModelId={selection?.modelId ?? null}
      recommendedModelId={recommendedModelId(catalog)}
    />
  );
}

function PickerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-52" />
        ))}
      </div>
    </div>
  );
}
