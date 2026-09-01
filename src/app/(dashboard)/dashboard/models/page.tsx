/**
 * صفحه‌ی «هوش مصنوعی» (Server component) — انتخابِ مدلی که کارجو با آن فکر می‌کند.
 *
 * الگوی Next 16 (پوسته‌ی فوری + استریم): پوسته در `dashboard/layout.tsx` استاتیک است؛ این
 * صفحه فقط محتوا می‌دهد. کاتالوگِ فعال و انتخابِ کاربر مستقیم از DB خوانده می‌شوند (الگوی
 * RSC، بدونِ round-trip به API) و به پیکرِ کلاینت پاس می‌شوند. بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود. ذخیره سمتِ کلاینت با
 * PUT /api/ai-settings (مقید به نشستِ همان کاربر).
 *
 * چرا این صفحه بازنویسی شد: عمیق‌ترین لایه‌ی اصطلاحاتِ فنیِ محصول این‌جا بود —
 * «ارائه‌دهنده»، «مدل»، «تومان به‌ازای هر ۱۰۰۰ توکن» — در حالی که مخاطب یک کارجوی
 * غیرِفنی است و این انتخاب بی‌سروصدا روی تطبیقِ آگهی، انگیزه‌نامه و خواندنِ رزومه اثر
 * می‌گذارد. تصمیم‌ها:
 *   • صفحه با «لازم نیست کاری کنی» شروع می‌شود؛ پیش‌فرض یک انتخابِ درست است، نه یک خلأ.
 *   • اثرِ این انتخاب صریح گفته می‌شود (سه کاری که واقعاً تغییر می‌کند).
 *   • گروه‌بندی بر اساسِ ارائه‌دهنده حذف شد؛ نامِ شرکتِ سازنده تصمیمِ کارجو نیست.
 *   • قیمتِ خام حذف نشد، فقط به «جزئیاتِ فنی» منتقل شد (در خودِ کارتِ مدل).
 *
 * `isDefault` از `getUserModelSelection` عمداً به UI می‌رسد تا صفحه بتواند بینِ «پیش‌فرضِ
 * سیستم» و «انتخابِ خودت» تفاوت بگذارد — پیش‌تر هر دو یکسان «انتخاب‌شده» نشان داده می‌شدند.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ModelPicker } from "@/components/dashboard/model-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { IconSparkle } from "@/components/dashboard/icons";
import {
  Callout,
  PageHeader,
  Skeleton,
} from "@/components/dashboard/ui";
import {
  getEnabledCatalog,
  getUserModelSelection,
  recommendedModelId,
  PROVIDER_LABEL_FA,
} from "@/lib/ai-settings/store";
import { SectionTabs, ACCOUNT_TABS } from "@/components/dashboard/section-tabs";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "هوش مصنوعی",
  robots: { index: false, follow: false },
};

export default async function ModelsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="هوش مصنوعی"
        subtitle="این انتخاب تعیین می‌کند کارجو با چه چیزی آگهی‌ها را بسنجد، انگیزه‌نامه بنویسد و رزومه‌تان را بخواند."
      />
      <SectionTabs tabs={ACCOUNT_TABS} active="/dashboard/models" ariaLabel="زبانه‌های حساب" />

      <Callout tone="info" icon={<IconSparkle />} title="لازم نیست چیزی را عوض کنید">
        پیش‌فرضِ کارجو برای اغلبِ کاربران بهترین انتخاب است؛ این صفحه فقط برای وقتی است که
        بخواهید نتیجه‌ی دقیق‌تر یا هزینه‌ی کمتر را ترجیح دهید.
      </Callout>

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

  // نامِ ارائه‌دهنده به برچسبِ نمایشی تبدیل می‌شود چون UI دیگر بر اساسِ آن گروه‌بندی
  // نمی‌کند و فقط در «جزئیاتِ فنی» نشانش می‌دهد.
  const models = catalog.map((m) => ({
    modelId: m.modelId,
    displayName: m.displayName,
    providerLabel: PROVIDER_LABEL_FA[m.provider] ?? m.provider,
    inputPer1kToman: m.inputPer1kToman,
    outputPer1kToman: m.outputPer1kToman,
    contextWindow: m.contextWindow,
    tags: m.tags,
  }));

  return (
    <ModelPicker
      models={models}
      initialSelectedModelId={selection?.modelId ?? null}
      recommendedModelId={recommendedModelId(catalog)}
      isDefaultSelection={selection?.isDefault ?? true}
    />
  );
}

/* ─────────────────── اسکلتِ پیکر (هم‌شکل: کارتِ شاخص + شبکه) ─────────────────── */

/** هم‌شکلِ ModelPicker: عنوانِ بخش + کارتِ پیشنهادِ کارجو + عنوان + شبکه‌ی گزینه‌ها. */
function PickerSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {/* پیشنهادِ کارجو */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <ModelCardSkeleton />
      </div>
      {/* گزینه‌های دیگر */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <ModelCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** هم‌شکلِ ModelCard: نام + جمله‌ی توضیح + نشان‌ها + جزئیاتِ بسته + دکمه. */
function ModelCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-3.5 w-4/5" />
      <div className="mt-3 flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-10 w-full rounded-xl" />
      <Skeleton className="mt-5 h-10 w-full rounded-full" />
    </div>
  );
}
