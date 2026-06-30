/**
 * صفحه‌ی «رزومه» (server component) — gate شده با نشست.
 *
 * کاربر: PDF آپلود می‌کند → متن استخراج می‌شود → با هوش مصنوعی فیلدها ساخته می‌شوند →
 * فیلدها را ویرایش و ذخیره می‌کند (روی پروفایلِ کارجو). فرمِ تعاملی یک client component
 * (ResumeManager) است؛ پروفایلِ اولیه و فهرستِ فایل‌ها در سرور (RSC) خوانده می‌شوند.
 *
 * همه به نشست مقید است (قاعده‌ی ۴: داده‌ی هر کاربر فقط برای همان کاربر). فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ResumeManager } from "@/components/dashboard/resume-manager";
import {
  getResumeFiles,
  getResumeProfile,
} from "@/components/dashboard/resume-data";
import { getDashboardUser } from "@/components/dashboard/session";
import { Card, SectionHeading, Skeleton, toFaDigits } from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "رزومه",
  robots: { index: false, follow: false },
};

export default async function ResumePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="resume">
      <SectionHeading
        title="رزومه‌ی شما"
        subtitle="فایلِ PDF رزومه‌تان را آپلود کنید تا هوش مصنوعی فیلدهای آن (مهارت‌ها، سابقه، شهر و …) را استخراج کند و پروفایلِ شما را کامل کند."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ManagerSkeleton />}>
            <ResumeManagerSection userId={user.userId} />
          </Suspense>
        </div>

        <div className="space-y-6">
          <Suspense fallback={<Skeleton className="h-40" />}>
            <UploadedFiles userId={user.userId} />
          </Suspense>
        </div>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function ResumeManagerSection({ userId }: { userId: string }) {
  const profile = await getResumeProfile(userId);
  return <ResumeManager initialProfile={profile} />;
}

async function UploadedFiles({ userId }: { userId: string }) {
  const files = await getResumeFiles(userId);

  return (
    <Card className="p-6">
      <h3 className="text-base font-bold">فایل‌های آپلودشده</h3>
      <p className="mt-1 text-sm text-muted">
        تاریخچه‌ی رزومه‌هایی که آپلود کرده‌اید.
      </p>

      {files.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-card/50 px-4 py-5 text-center text-sm text-muted">
          هنوز فایلی آپلود نشده است.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="rounded-xl border border-border px-3.5 py-2.5"
            >
              <div className="truncate text-sm font-medium" title={f.fileName}>
                {f.fileName}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="ltr-nums">{formatBytes(f.byteSize)}</span>
                <span aria-hidden>·</span>
                <span>{f.hasText ? "متن استخراج‌شده" : "بدون متن"}</span>
                {f.isParsed ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-brand">پردازش‌شده</span>
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

function ManagerSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32" />
      <Skeleton className="h-72" />
    </div>
  );
}
