/**
 * نمای «فیلترهای اپلای» (Server component) — قلبِ جریانِ پیش‌فرضِ محصول (پیوُت).
 *
 * کاربر فیلترهای *خودِ جابینجا* را می‌چیند (دسته/شهر/نوعِ همکاری/دورکاری/حداقلِ حقوق/ترتیب)
 * و کارجو به همه‌ی آگهی‌های همین جست‌وجو اپلای می‌کند — بدونِ نیاز به AI. تطبیقِ هوشمند یک
 * لایه‌ی اختیاریِ پریمیوم روی این است، نه پیش‌نیاز.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. حضورِ نشست پیش‌تر در
 * `proxy.ts` چک شده؛ این‌جا فقط `userId` را می‌گیریم. بخشِ وابسته به DB/شبکه داخلِ
 * `<Suspense>` با اسکلتِ هم‌شکل استریم می‌شود. داده مقید به userIdِ نشست (§۱۰).
 *
 * URLِ پیش‌نمایشِ اولیه با `buildSearchUrl`ِ خودِ کانکتور ساخته می‌شود تا اولین رندر دقیقاً
 * همان جست‌وجویی را نشان دهد که کارجو هدف می‌گیرد؛ ویرایشگر آن را زنده به‌روز می‌کند.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  AiFilterCardSkeleton,
  AiFilterToggleCard,
} from "@/components/dashboard/ai-filter-card";
import {
  ApplyFiltersEditor,
  type InitialApplyFilters,
} from "@/components/dashboard/apply-filters-editor";
import { getDashboardUser } from "@/components/dashboard/session";
import { PageHeader, Skeleton } from "@/components/dashboard/ui";
import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import { getJobinjaCategories } from "@/lib/apply/boards/jobinja-categories";
import { readApplyFilters, toJobPreferences } from "@/lib/apply/filters";
import type { CategoryOption } from "@/lib/apply/apply-filters-form";

// راستی‌آزماییِ نشست + خواندنِ DB + واکشیِ دسته‌ها → اجرای Node (استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "فیلترهای اپلای",
  robots: { index: false, follow: false },
};

export default async function ApplyFiltersPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="فیلترهای اپلای"
        subtitle="دسته و فیلترهای خودِ جابینجا را انتخاب کنید؛ کارجو به همه‌ی آگهی‌های همین جست‌وجو اپلای می‌کند — بدونِ نیاز به هوش مصنوعی. تطبیقِ هوشمند یک افزودنیِ اختیاریِ پریمیوم است."
      />

      <Suspense fallback={<EditorSkeleton />}>
        <EditorSection userId={user.userId} />
      </Suspense>

      {/* لایه‌ی اختیاریِ پریمیوم — تاگلِ «فیلترِ هوشمند (AI)» روی فیلترهای بالا. کارتِ خودکفا
          وضعیتِ استحقاق را می‌خواند و تاگلِ کارآمد یا دعوت به ارتقا نشان می‌دهد (§Phase 4). */}
      <Suspense fallback={<AiFilterCardSkeleton />}>
        <AiFilterToggleCard userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function EditorSection({ userId }: { userId: string }) {
  // دسته‌ها (مستقل از کاربر، کشِ ۶ساعته‌ی داخلی) + فیلترهای همین کاربر را موازی بخوان.
  const [{ categories, source }, filters] = await Promise.all([
    getJobinjaCategories(),
    readApplyFilters(userId),
  ]);

  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    slug: c.slug,
    name: c.name,
    englishName: c.englishName,
  }));

  const initialFilters: InitialApplyFilters = {
    categorySlugs: filters.categorySlugs,
    cities: filters.cities,
    jobTypes: filters.jobTypes,
    remoteOnly: filters.remoteOnly,
    ...(filters.minSalary === undefined ? {} : { minSalary: filters.minSalary }),
    ...(filters.sort === undefined ? {} : { sort: filters.sort }),
  };

  // URLِ پیش‌نمایشِ اولیه با buildSearchUrl (منبعِ حقیقتِ سرور) — بدونِ titles تا دقیقاً
  // بازتابِ همان چیزی باشد که در پیکر انتخاب شده. (شیِ صریح تا با Record<string,unknown> بخوانَد.)
  const initialPreviewUrl = buildSearchUrl(
    toJobPreferences({
      categorySlugs: initialFilters.categorySlugs,
      cities: initialFilters.cities,
      jobTypes: initialFilters.jobTypes,
      remoteOnly: initialFilters.remoteOnly,
      ...(initialFilters.minSalary === undefined ? {} : { minSalary: initialFilters.minSalary }),
      ...(initialFilters.sort === undefined ? {} : { sort: initialFilters.sort }),
    }),
    1,
  );

  return (
    <ApplyFiltersEditor
      categories={categoryOptions}
      categoriesPartial={source === "fallback"}
      initialFilters={initialFilters}
      initialPreviewUrl={initialPreviewUrl}
    />
  );
}

/* ─────────────────── اسکلتِ هم‌شکلِ ویرایشگر (نه بلاکِ خالی) ─────────────────── */

function EditorSkeleton() {
  const catWidths = [
    "w-24", "w-32", "w-20", "w-28", "w-36", "w-24", "w-28", "w-20", "w-32", "w-24",
  ];
  return (
    <div className="space-y-6" aria-hidden>
      {/* نوارِ ذخیره */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
      {/* پیش‌نمایشِ هدف */}
      <div className="rounded-2xl border border-brand/30 bg-brand/[0.06] p-6">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
        </div>
      </div>
      {/* کارتِ دسته‌ها */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="mb-3 h-10 w-full rounded-xl" />
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface/40 p-3">
          {catWidths.map((w, i) => (
            <Skeleton key={i} className={`h-9 rounded-full ${w}`} />
          ))}
        </div>
      </div>
      {/* دو کارتِ کوچک‌تر */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="mb-4 h-4 w-28" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="mb-4 h-4 w-32" />
        <div className="grid gap-2 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
