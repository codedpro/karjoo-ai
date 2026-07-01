/**
 * صفحه‌ی «رزومه و پروفایل» (Server component) — gate شده با نشست.
 *
 * کاربر: PDF آپلود می‌کند → یا آن را «رزومه‌ی اصلی» می‌کند (رایگان، بی‌AI) یا با هوش
 * مصنوعی فیلدهایش را استخراج می‌کند (پولی) → پروفایلِ جامع را ویرایش و ذخیره می‌کند.
 * تعاملْ در ResumeWorkspace (client) است؛ پروفایلِ اولیه و فهرستِ فایل‌ها در سرور (RSC).
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ استاتیکِ خودش را با `PageHeader` بی‌درنگ می‌آورد. بخشِ وابسته به DB
 * داخلِ `<Suspense>` با اسکلتِ هم‌شکلِ محتوا استریم می‌شود. مقید به نشست (قاعده‌ی ۴). فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import { getDashboardUser } from "@/components/dashboard/session";
import { ResumeWorkspace } from "@/components/dashboard/resume/resume-workspace";
import type { ClientResumeFile } from "@/components/dashboard/resume/profile-types";
import { PageHeader, Skeleton, SkeletonText } from "@/components/dashboard/ui";

import { getFullResumeProfile, getResumeFileList } from "./data";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "رزومه و پروفایل",
  robots: { index: false, follow: false },
};

export default async function ResumePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="رزومه و پروفایل"
        subtitle="پروفایلِ خود را کامل کنید تا هوش مصنوعی بهتر برایتان کار پیدا کند. رزومه‌ی PDF را آپلود کنید و یا با هوش مصنوعی فیلدها را استخراج کنید، یا فایل را مستقیم رزومه‌ی اصلی‌تان کنید."
      />

      <Suspense fallback={<WorkspaceSkeleton />}>
        <WorkspaceSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function WorkspaceSection({ userId }: { userId: string }) {
  const [profile, files, costCtx] = await Promise.all([
    getFullResumeProfile(userId),
    getResumeFileList(userId),
    getUserAiCostContext(userId),
  ]);

  // فایل‌ها را به شکلِ سریال‌پذیرِ کلاینت تبدیل می‌کنیم (createdAt به ISO string).
  const clientFiles: ClientResumeFile[] = files.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    byteSize: f.byteSize,
    hasText: f.hasText,
    isParsed: f.isParsed,
    isPrimary: f.isPrimary,
    createdAt: f.createdAt.toISOString(),
  }));

  return (
    <ResumeWorkspace
      initialProfile={profile}
      files={clientFiles}
      // استخراجِ AIِ رزومه یک کنشِ پولی است (resume_parse) → تخمینِ هزینه به UI.
      parseCostEstimate={actionEstimate(costCtx, "resume_parse")}
      balanceToman={costCtx.balanceToman}
    />
  );
}

/* ─────────────────────────────── اسکلت ────────────────────────────────── */

/** اسکلتِ هم‌شکلِ ResumeWorkspace — دو ستون: فرمِ پروفایل + پنلِ فایل‌ها. */
function WorkspaceSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-5" aria-hidden>
      {/* ستونِ فرمِ پروفایل */}
      <div className="space-y-6 lg:col-span-3">
        {Array.from({ length: 3 }).map((_, c) => (
          <div
            key={c}
            className="rounded-2xl border border-border bg-card p-6 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-11 w-full rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ستونِ فایل‌ها */}
      <div className="space-y-6 lg:col-span-2">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="mt-4 h-32 w-full rounded-2xl" />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="space-y-3 rounded-2xl border border-border p-4"
              >
                <Skeleton className="h-4 w-3/4" />
                <SkeletonText lines={1} />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-32 rounded-full" />
                  <Skeleton className="h-8 w-24 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
