/**
 * «بایگانیِ ارسال‌ها» — سابقه‌ی کاملِ آن‌چه *ما* از طرفِ کاربر فرستاده‌ایم.
 *
 * سه صفحه‌ی تاریخچه با *سؤالی که جواب می‌دهند* از هم جدا شده‌اند و کاربر نباید حتی یک
 * لحظه بپرسد «چرا سه تا؟». پس این صفحه یک جمله‌ی بازکننده دارد و یک یادداشتِ کوتاه که
 * مرزش را با «پرونده‌ی جابینجا» صریح می‌گوید:
 *   • این‌جا: چه فرستادیم و با کدام نسخه‌ی رزومه (دفترِ خودِ ما).
 *   • پرونده‌ی جابینجا: کارفرما در سایتِ خودش چه وضعیتی ثبت کرده (آینه‌ی سایت).
 *   • وضعیتِ اپلای‌ها: همین حالا چه چیزی در حالِ ارسال است.
 *
 * چیدمان: پوسته‌ی داشبورد خودش `.dash-container` (سیالِ سقف‌دار) و بالشتک دارد؛ این صفحه
 * هیچ `mx-auto max-w-*`ی نمی‌سازد — قبلاً می‌ساخت و نتیجه‌اش دو-بار-بالشتک و ستونِ باریک
 * در نمایشگرِ بزرگ بود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { IconArchive, IconBolt, IconChart } from "@/components/dashboard/icons";
import {
  ButtonLink,
  Callout,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonTable,
  toFaDigits,
} from "@/components/dashboard/ui";
import {
  ApplicationArchiveTable,
  type ArchiveRow,
} from "@/components/dashboard/application-archive-table";
import { listApplicationArchive } from "@/lib/apply/application-archive";
import { SectionTabs, APPLY_TABS } from "@/components/dashboard/section-tabs";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "بایگانیِ ارسال‌ها",
  robots: { index: false, follow: false },
};

export default async function ArchivePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        title="بایگانیِ ارسال‌ها"
        subtitle="هر درخواستی که ما از طرفِ تو فرستادیم — با شرحِ همان آگهی و همان نسخه‌ای از رزومه که واقعاً ارسال شد."
      />
      <SectionTabs tabs={APPLY_TABS} active="/dashboard/archive" ariaLabel="زبانه‌های اپلای‌ها" />

      <Callout
        icon={<IconChart />}
        title="این‌جا کارِ ماست، نه پاسخِ کارفرما"
      >
        برای دیدنِ اینکه کارفرما درخواستت را در چه مرحله‌ای دیده، سراغِ «پرونده‌ی
        جابینجا» برو.
      </Callout>

      <Suspense fallback={<ArchiveSkeleton />}>
        <ArchiveSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ArchiveSection({ userId }: { userId: string }) {
  const items = await listApplicationArchive(userId, 200);

  // تاریخ‌ها برای مرزِ سرور→کلاینت باید سریال‌پذیر باشند.
  const rows: ArchiveRow[] = items.map((i) => ({
    ...i,
    submittedAt: i.submittedAt ? i.submittedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<IconArchive />}
        title="هنوز چیزی فرستاده نشده"
        body="به‌محضِ اولین ارسال، شرکت، شرحِ شغل و همان رزومه‌ای که فرستادیم این‌جا بایگانی می‌شود."
        action={
          <ButtonLink href="/dashboard/auto-apply" size="sm">
            <IconBolt className="h-4 w-4" />
            روشن‌کردنِ اپلای خودکار
          </ButtonLink>
        }
      />
    );
  }

  const withResume = rows.filter((r) => r.resume).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        از {toFaDigits(rows.length)} ارسال، برای {toFaDigits(withResume)} مورد رزومه‌ی
        سفارشیِ همان آگهی ذخیره شده است.
      </p>
      <ApplicationArchiveTable rows={rows} />
    </div>
  );
}

/* ─────────────────────── اسکلتِ هم‌شکلِ محتوا ─────────────────────── */

/** هم‌شکلِ محتوا: خطِ خلاصه + نوارِ جست‌وجو + جدولِ شش‌ستونی. */
function ArchiveSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-3 w-64" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-full max-w-xs rounded-xl" />
        <Skeleton className="h-3 w-24" />
      </div>
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
