/**
 * نمای «علاقه‌مندی‌ها» (Server component) — انتخابِ دسته‌بندیِ شغلیِ موردِنظرِ کاربر.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط
 * محتوا می‌دهد و هدرِ استاتیکِ خودش را با `PageHeader` بی‌درنگ می‌آورد. حضورِ نشست پیش‌تر در
 * `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط `userId` را می‌گیریم. بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ هم‌شکلِ چیپ‌ها استریم می‌شود.
 *
 * کش: تاکسونومیِ دسته‌ها *مستقل از کاربر* است (جدولِ سراسریِ job_categories) → با `unstable_cache`
 * بین درخواست‌ها کش می‌شود (تگِ `interests-taxonomy`، بازاعتبارِ روزانه). چون پرچمِ سراسریِ
 * `cacheComponents` عمداً خاموش است (تصمیمِ Foundation)، `use cache` در دسترس نیست و این مسیرِ
 * مستندِ «کش بدونِ cacheComponents» است. انتخابِ کاربر مقید به userId و کش‌نشده می‌ماند.
 */
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  InterestsPicker,
  type PickerGroup,
} from "@/components/dashboard/interests-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { PageHeader, Skeleton } from "@/components/dashboard/ui";
import {
  getAllCategories,
  getSelectedSlugs,
  type CategoryRow,
} from "@/lib/interests/store";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "علاقه‌مندی‌ها",
  robots: { index: false, follow: false },
};

/**
 * تاکسونومیِ دسته‌ها مستقل از کاربر است (بدونِ کوکی/userId) → کشِ بین‌درخواستی امن است.
 * تگ‌گذاری تا با تغییرِ تاکسونومی قابلِ بازاعتبار باشد؛ بازاعتبارِ زمانیِ روزانه به‌عنوانِ سقف.
 */
const getCachedCategories = unstable_cache(
  async () => getAllCategories(),
  ["interests-taxonomy"],
  { tags: ["interests-taxonomy"], revalidate: 60 * 60 * 24 },
);

export default async function InterestsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="دسته‌بندی‌های موردِ علاقه"
        subtitle="زمینه‌های شغلیِ موردِنظرتان را انتخاب کنید؛ کارجو آگهی‌های مرتبط را برایتان پیدا و امتیازدهی می‌کند."
      />

      <Suspense fallback={<PickerSkeleton />}>
        <PickerSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function PickerSection({ userId }: { userId: string }) {
  // تاکسونومیِ کش‌شده (مستقل از کاربر) + انتخابِ کش‌نشده‌ی همین کاربر را موازی بخوان.
  const [categories, selected] = await Promise.all([
    getCachedCategories(),
    getSelectedSlugs(userId),
  ]);

  return (
    <InterestsPicker groups={toPickerGroups(categories)} initialSelected={selected} />
  );
}

/**
 * ردیف‌های تاکسونومی → گروه‌های پیکر. تاکسونومیِ فعلی تک‌سطحی است (همه parentId=null)،
 * پس یک گروهِ بی‌عنوان همه‌ی دسته‌ها را در بر می‌گیرد؛ ساختار از زیرشاخه پشتیبانی می‌کند
 * و وقتی parentId پر شود، هر والد گروهِ خود می‌شود.
 */
function toPickerGroups(rows: CategoryRow[]): PickerGroup[] {
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const childrenOf = new Map<string, CategoryRow[]>();
  const roots: CategoryRow[] = [];

  for (const row of rows) {
    if (row.parentId && byId.has(row.parentId)) {
      const list = childrenOf.get(row.parentId) ?? [];
      list.push(row);
      childrenOf.set(row.parentId, list);
    } else {
      roots.push(row);
    }
  }

  // اگر هیچ والدی نیست (تک‌سطحی)، یک گروهِ بی‌عنوانِ واحد بساز.
  const hasHierarchy = roots.some((r) => childrenOf.has(r.id));
  if (!hasHierarchy) {
    return [
      {
        parentLabelFa: null,
        categories: roots.map((r) => ({
          slug: r.slug,
          labelFa: r.labelFa,
          labelEn: r.labelEn,
        })),
      },
    ];
  }

  return roots.map((root) => {
    const children = childrenOf.get(root.id) ?? [];
    return {
      parentLabelFa: root.labelFa,
      categories: (children.length > 0 ? children : [root]).map((r) => ({
        slug: r.slug,
        labelFa: r.labelFa,
        labelEn: r.labelEn,
      })),
    };
  });
}

/** اسکلتِ هم‌شکلِ پیکر — نوارِ چسبانِ ذخیره + شبکه‌ی چیپ‌های دسته با عرض‌های متنوع. */
function PickerSkeleton() {
  // عرض‌های متنوع تا اسکلت طبیعی‌تر از یک شبکه‌ی یک‌دست به‌نظر برسد.
  const widths = [
    "w-24", "w-32", "w-20", "w-28", "w-36", "w-24", "w-28", "w-20",
    "w-32", "w-24", "w-36", "w-28", "w-20", "w-32", "w-24", "w-28",
    "w-24", "w-36",
  ];
  return (
    <div aria-hidden>
      {/* نوارِ وضعیت/ذخیره */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-36 rounded-full" />
      </div>
      {/* چیپ‌های دسته */}
      <div className="flex flex-wrap gap-2.5">
        {widths.map((w, i) => (
          <Skeleton key={i} className={`h-9 rounded-full ${w}`} />
        ))}
      </div>
    </div>
  );
}
