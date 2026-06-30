/**
 * نمای «علاقه‌مندی‌ها» (server component) — انتخابِ دسته‌بندیِ شغلیِ موردِنظرِ کاربر.
 *
 * gate شده با نشست. تاکسونومی و انتخابِ فعلیِ کاربر مستقیم از DB خوانده می‌شوند (الگوی
 * RSC، بدونِ round-trip به API)، سپس به پیکرِ گروهیِ کلاینت پاس داده می‌شوند. ذخیره از
 * سمتِ کلاینت با PUT /api/interests انجام می‌شود (که به نشستِ همین کاربر مقید است).
 *
 * این انتخاب‌ها titles/categoriesِ JobPreferences را تغذیه می‌کنند که موتورِ
 * جست‌وجو/تطبیق برای پیداکردنِ آگهی‌های مرتبط استفاده می‌کند.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  InterestsPicker,
  type PickerGroup,
} from "@/components/dashboard/interests-picker";
import { getDashboardUser } from "@/components/dashboard/session";
import { SectionHeading, Skeleton } from "@/components/dashboard/ui";
import { getAllCategories, getSelectedSlugs, type CategoryRow } from "@/lib/interests/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "علاقه‌مندی‌ها",
  robots: { index: false, follow: false },
};

export default async function InterestsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="interests">
      <SectionHeading
        title="دسته‌بندی‌های موردِ علاقه"
        subtitle="زمینه‌های شغلیِ موردِنظرتان را انتخاب کنید؛ کارجو آگهی‌های مرتبط را برایتان پیدا و امتیازدهی می‌کند."
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
  // تاکسونومی و انتخابِ کاربر را موازی بخوان.
  const [categories, selected] = await Promise.all([
    getAllCategories(),
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

function PickerSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-14" />
      <div className="flex flex-wrap gap-2.5">
        {Array.from({ length: 18 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>
    </div>
  );
}
