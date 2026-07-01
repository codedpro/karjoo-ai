/**
 * نمای «مدلِ هوش مصنوعی» (Server component) — انتخابِ مدلِ پولیِ کاربر.
 *
 * الگوی Next 16 (پوسته‌ی فوری + استریم): پوسته در `dashboard/layout.tsx` استاتیک است؛
 * این صفحه فقط محتوا می‌دهد. کاتالوگِ فعال و انتخابِ فعلیِ کاربر مستقیم از DB خوانده
 * می‌شوند (الگوی RSC، بدونِ round-trip به API)، سپس به مدل‌پیکرِ کلاینت پاس داده می‌شوند.
 * بخشِ وابسته به DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** (تب‌ها + شبکه‌ی کارت)
 * استریم می‌شود. ذخیره از سمتِ کلاینت با PUT /api/ai-settings (مقید به نشستِ همان کاربر).
 *
 * این انتخاب تعیین می‌کند فراخوانی‌های پولیِ هوش مصنوعی (تطبیق/انگیزه‌نامه/استخراجِ رزومه)
 * با کدام مدل اجرا شوند و چه قیمتی (تومان) از کیف‌پول کسر شود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ModelPicker } from "@/components/dashboard/model-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { PageHeader, ButtonLink, Skeleton } from "@/components/dashboard/ui";
import {
  getEnabledCatalog,
  getUserModelSelection,
  groupByProvider,
  recommendedModelId,
} from "@/lib/ai-settings/store";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "مدلِ هوش مصنوعی",
  robots: { index: false, follow: false },
};

export default async function ModelsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="انتخابِ مدلِ هوش مصنوعی"
        subtitle="مدلی را که برای تطبیقِ شغل، نگارشِ انگیزه‌نامه و پردازشِ رزومه به‌کار می‌رود انتخاب کن. قیمت‌ها به تومان به‌ازای هر ۱۰۰۰ توکن است و به‌میزانِ مصرف از کیف‌پول کسر می‌شود."
        actions={
          <ButtonLink href="/dashboard/billing" variant="secondary" size="sm">
            کیف‌پول و صورتحساب
          </ButtonLink>
        }
      />

      <Suspense fallback={<PickerSkeleton />}>
        <PickerSection userId={user.userId} />
      </Suspense>
    </div>
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

/* ─────────────────── اسکلتِ مدل‌پیکر (هم‌شکل: تب‌ها + کارت‌ها) ─────────────────── */

/** هم‌شکلِ ModelPicker: ردیفِ تب‌های provider + شبکه‌ی کارتِ مدل. */
function PickerSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* تب‌های provider */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-24 rounded-full" />
        <Skeleton className="h-10 w-28 rounded-full" />
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>
      {/* شبکه‌ی کارتِ مدل */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-5 shadow-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
            </div>
            <div className="mt-3 flex gap-1.5">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="mt-5 h-9 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
