/**
 * صفحه‌ی «رزومه» (Server component) — gate شده با نشست.
 *
 * کاربر: PDF آپلود می‌کند → متن استخراج می‌شود → با هوش مصنوعی فیلدها ساخته می‌شوند →
 * فیلدها را ویرایش و ذخیره می‌کند (روی پروفایلِ کارجو). فرمِ تعاملی یک client component
 * (ResumeManager) است؛ پروفایلِ اولیه و فهرستِ فایل‌ها در سرور (RSC) خوانده می‌شوند.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه فقط
 * محتوا می‌دهد و هدرِ استاتیکِ خودش را با `PageHeader` بی‌درنگ می‌آورد. هر بخشِ وابسته به DB داخلِ
 * `<Suspense>` با اسکلتِ هم‌شکلِ محتوا استریم می‌شود. همه مقید به نشست (قاعده‌ی ۴). فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ResumeManager } from "@/components/dashboard/resume-manager";
import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import {
  getResumeFiles,
  getResumeProfile,
} from "@/components/dashboard/resume-data";
import { getDashboardUser } from "@/components/dashboard/session";
import { IconDoc } from "@/components/dashboard/track-icons";
import {
  Card,
  PageHeader,
  Skeleton,
  SkeletonText,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "رزومه",
  robots: { index: false, follow: false },
};

export default async function ResumePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;

  return (
    <div className="space-y-8">
      <PageHeader
        title="رزومه‌ی شما"
        subtitle="فایلِ PDF رزومه‌تان را آپلود کنید تا هوش مصنوعی فیلدهای آن (مهارت‌ها، سابقه، شهر و …) را استخراج کند و پروفایلِ شما را کامل کند."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ManagerSkeleton />}>
            <ResumeManagerSection userId={userId} />
          </Suspense>
        </div>

        <aside className="space-y-6">
          <Suspense fallback={<FilesSkeleton />}>
            <UploadedFiles userId={userId} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function ResumeManagerSection({ userId }: { userId: string }) {
  const [profile, costCtx] = await Promise.all([
    getResumeProfile(userId),
    getUserAiCostContext(userId),
  ]);
  // پردازشِ AIِ رزومه یک کنشِ پولی است (resume_parse) → تخمینِ هزینه را به فرم می‌دهیم.
  return (
    <ResumeManager
      initialProfile={profile}
      parseCostEstimate={actionEstimate(costCtx, "resume_parse")}
      balanceToman={costCtx.balanceToman}
    />
  );
}

async function UploadedFiles({ userId }: { userId: string }) {
  const files = await getResumeFiles(userId);

  return (
    <Card padded>
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
          aria-hidden
        >
          <IconDoc className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-balance text-base font-bold leading-tight">
            فایل‌های آپلودشده
          </h2>
          <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
            تاریخچه‌ی رزومه‌هایی که آپلود کرده‌اید.
          </p>
        </div>
      </div>

      {files.length === 0 ? (
        <p className="mt-5 text-pretty rounded-xl border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-xs leading-6 text-muted">
          هنوز فایلی آپلود نشده است.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="rounded-xl border border-border bg-surface/40 px-3.5 py-2.5"
            >
              <div className="truncate text-sm font-medium" title={f.fileName}>
                {f.fileName}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <span className="ltr-nums whitespace-nowrap">
                  {formatBytes(f.byteSize)}
                </span>
                <span aria-hidden>·</span>
                <span className="whitespace-nowrap">
                  {f.hasText ? "متن استخراج‌شده" : "بدون متن"}
                </span>
                {f.isParsed ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="whitespace-nowrap font-medium text-brand">
                      پردازش‌شده
                    </span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ─────────────────────────────── اجزای کوچک ────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${toFaDigits(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${toFaDigits(Math.round(kb))} کیلوبایت`;
  return `${toFaDigits((kb / 1024).toFixed(1))} مگابایت`;
}

/** اسکلتِ هم‌شکلِ ResumeManager — کارتِ آپلود + کارتِ فرمِ ویرایش. */
function ManagerSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* کارتِ گامِ ۱ و ۲ */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <SkeletonText lines={2} className="mt-3" />
        <div className="mt-4 flex flex-wrap gap-3">
          <Skeleton className="h-11 w-40 rounded-full" />
          <Skeleton className="h-11 w-48 rounded-full" />
        </div>
      </div>
      {/* کارتِ گامِ ۳ (فرم) */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="h-5 w-52" />
        <SkeletonText lines={1} className="mt-3" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** اسکلتِ هم‌شکلِ فهرستِ فایل‌ها — سرسطر + چند ردیفِ فایل. */
function FilesSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-xl border border-border px-3.5 py-2.5"
          >
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
