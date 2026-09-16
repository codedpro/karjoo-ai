/**
 * مرکزِ واحدِ رزومه، تنظیم‌های تولید، پروفایل سایت‌های کاریابی و هدف‌گیری شغل‌ها.
 * مسیرهای قدیمیِ رزومه، علاقه‌مندی‌ها و فیلترها به لنگرهای همین صفحه redirect می‌شوند.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. بخشِ وابسته به DB داخلِ
 * `<Suspense>` استریم می‌شود.
 *
 * تصمیم‌های این بازنویسی:
 *   • **زبانه‌ها به‌جای یک صفحه‌ی بلند**: هر بخش زبانه‌ی خودش را با نشانیِ `?tab=` دارد
 *     (بدونِ JS کار می‌کند و قابلِ بوکمارک است) و فقط داده‌ی همان زبانه خوانده می‌شود.
 *     لینک‌های قدیمیِ `#resume-settings`، `#providers` و `#targeting` با
 *     `LegacyHashTab` به زبانه‌ی درست می‌روند.
 *   • **حالتِ خالی**: کاربرِ تازه پیش‌تر با داربستِ خالیِ فرم روبه‌رو می‌شد. حالا اگر نه
 *     پروفایلی هست و نه فایلی، یک فراخوانِ روشن («رزومه‌ی PDF را آپلود کن») بالای بخش
 *     می‌نشیند و مستقیم به کارتِ آپلود لنگر می‌زند.
 *   • **دادهٔ صفحه** از `@/components/dashboard/resume/profile-data` می‌آید، نه از پوشه‌ی
 *     `../resume` (که فقط یک redirect است) — وابستگیِ بین-routeیِ شکننده حذف شد.
 *
 * حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ اینجا فقط `userId` را می‌گیریم.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LegacyHashTab } from "./legacy-hash-tab";

import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import { getDashboardUser } from "@/components/dashboard/session";
import { IconUpload } from "@/components/dashboard/icons";
import { JobinjaProfileEdit } from "@/components/dashboard/jobinja-profile-edit";
import { getProviderProfiles } from "@/components/dashboard/provider-profile-data";
import { ProviderProfilesGrid } from "@/components/dashboard/provider-profiles-grid";
import { ProviderTargetingSection } from "@/components/dashboard/provider-targeting-section";
import {
  getFullResumeProfile,
  getResumeFileList,
} from "@/components/dashboard/resume/profile-data";
import { ResumeWorkspace } from "@/components/dashboard/resume/resume-workspace";
import type { ClientResumeFile } from "@/components/dashboard/resume/profile-types";
import { ResumeSettingsEditor } from "@/components/dashboard/resume-settings-editor";
import { SectionTabs } from "@/components/dashboard/section-tabs";
import {
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonText,
} from "@/components/dashboard/ui";
import { getProfileSnapshot } from "@/lib/apply/boards/jobinja-read";
import { SKILL_DOMAINS } from "@/lib/resume/declared-domains";
import { RESUME_TEMPLATES } from "@/lib/resume/resume-templates";
import { BROAD_MATCHING_SECTIONS, readResumeSettings } from "@/lib/resume/settings";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "پروفایل‌ها و تنظیم‌ها",
  robots: { index: false, follow: false },
};

const BASE_HREF = "/dashboard/profiles";

/** زبانه‌های صفحه — منبعِ حقیقتِ نوارِ زبانه و عنوان‌ها. اولی پیش‌فرض است. */
const TABS = [
  { id: "resume", label: "رزومه و پروفایلِ کارجو" },
  { id: "resume-settings", label: "تنظیم‌های ساخت رزومه" },
  { id: "providers", label: "پروفایل سایت‌های کاریابی" },
  { id: "targeting", label: "هدف‌گیری شغل‌ها" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function tabHref(id: TabId): string {
  return id === "resume" ? BASE_HREF : `${BASE_HREF}?tab=${id}`;
}

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, raw] = await Promise.all([getDashboardUser(), searchParams]);
  if (!user) redirect("/login");
  const requested = Array.isArray(raw.tab) ? raw.tab[0] : raw.tab;
  const tab: TabId = TABS.find((t) => t.id === requested)?.id ?? "resume";

  return (
    <div className="space-y-8">
      <PageHeader
        title="پروفایل‌ها و تنظیم‌ها"
        subtitle="اطلاعات رزومه، دامنه‌های تخصصی و پروفایل هر سایت کاریابی از یک محل مدیریت می‌شود."
      />
      <LegacyHashTab tabs={TABS.map((t) => ({ id: t.id, href: tabHref(t.id) }))} />
      <SectionTabs
        tabs={TABS.map((t) => ({ href: tabHref(t.id), label: t.label }))}
        active={tabHref(tab)}
        ariaLabel="زبانه‌های پروفایل"
      />

      <Suspense key={tab} fallback={<TabSkeleton />}>
        {tab === "resume" ? <ResumeTab userId={user.userId} /> : null}
        {tab === "resume-settings" ? <ResumeSettingsTab userId={user.userId} /> : null}
        {tab === "providers" ? <ProvidersTab userId={user.userId} /> : null}
        {tab === "targeting" ? <ProviderTargetingSection userId={user.userId} /> : null}
      </Suspense>
    </div>
  );
}

/* ───────────────────────── زبانه‌ها (async، داخلِ Suspense) ───────────────────────── */

async function ResumeTab({ userId }: { userId: string }) {
  const [profile, files, costCtx] = await Promise.all([
    getFullResumeProfile(userId),
    getResumeFileList(userId),
    getUserAiCostContext(userId),
  ]);

  const clientFiles: ClientResumeFile[] = files.map((f) => ({
    id: f.id,
    fileName: f.fileName,
    byteSize: f.byteSize,
    hasText: f.hasText,
    isParsed: f.isParsed,
    isPrimary: f.isPrimary,
    createdAt: f.createdAt.toISOString(),
  }));

  // کاربرِ تازه: نه پروفایلی ساخته، نه فایلی آپلود کرده ⇒ باید یک کارِ روشن ببیند.
  const isBlank = profile === null && files.length === 0;

  return (
    <div className="space-y-4">
      {isBlank ? (
        <EmptyState
          icon={<IconUpload />}
          title="هنوز رزومه‌ای اضافه نکرده‌اید"
          body="یک فایلِ PDF آپلود کنید تا هوش مصنوعی فیلدهای پروفایل را از رویش پر کند؛ بعد فقط بازبینی می‌کنید."
          action={
            <a
              href="#resume-files"
              className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-px"
            >
              <IconUpload className="h-4 w-4" />
              آپلودِ رزومه‌ی PDF
            </a>
          }
        />
      ) : null}

      <ResumeWorkspace
        initialProfile={profile}
        files={clientFiles}
        parseCostEstimate={actionEstimate(costCtx, "resume_parse")}
        balanceToman={costCtx.balanceToman}
        // کاربرِ بدونِ رزومه: در موبایل مستقیم روی تبِ «فایل‌ها» بنشین تا فراخوانِ
        // حالتِ خالی به یک ناحیه‌ی پنهان لنگر نزند.
        initialTab={isBlank ? "files" : "profile"}
      />
    </div>
  );
}

async function ResumeSettingsTab({ userId }: { userId: string }) {
  const resumeSettings = await readResumeSettings(userId);
  return (
    <ResumeSettingsEditor
      initial={resumeSettings}
      domains={SKILL_DOMAINS.map((domain) => ({ id: domain.id, label: domain.labelFa }))}
      sections={BROAD_MATCHING_SECTIONS.map((section) => ({ ...section }))}
      templates={RESUME_TEMPLATES.map((template) => ({
        id: template.id,
        label: template.labelFa,
        description: template.descriptionFa,
      }))}
    />
  );
}

async function ProvidersTab({ userId }: { userId: string }) {
  const [jobinjaSnapshot, providers] = await Promise.all([
    getProfileSnapshot(userId, "jobinja"),
    getProviderProfiles(userId),
  ]);
  const snapshotData = (jobinjaSnapshot?.data as Record<string, unknown> | undefined) ?? {};
  return (
    <div className="space-y-4">
      <ProviderProfilesGrid providers={providers} />
      <div className="max-w-2xl">
        <JobinjaProfileEdit
          initialJobTitle={pick(snapshotData, "headline", "jobTitle", "job_title", "title")}
          initialFullName={pick(snapshotData, "fullName", "full_name", "name")}
        />
      </div>
    </div>
  );
}

/* ───────────────────────── نگاشتِ اسنپ‌شاتِ جابینجا ───────────────────────── */

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function pick(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(data[k]);
    if (v) return v;
  }
  return null;
}

/* ───────────────────────── اسکلتِ زبانه ───────────────────────── */

function TabSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {Array.from({ length: 2 }).map((_, c) => (
        <div key={c} className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <SkeletonText className="mt-5" lines={4} />
        </div>
      ))}
    </div>
  );
}
