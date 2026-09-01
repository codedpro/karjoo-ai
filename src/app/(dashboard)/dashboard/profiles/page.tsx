/**
 * مرکزِ واحدِ رزومه، تنظیم‌های تولید، پروفایل سایت‌های کاریابی و هدف‌گیری شغل‌ها.
 * مسیرهای قدیمیِ رزومه، علاقه‌مندی‌ها و فیلترها به لنگرهای همین صفحه redirect می‌شوند.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. بخشِ وابسته به DB داخلِ
 * `<Suspense>` استریم می‌شود.
 *
 * تصمیم‌های این بازنویسی:
 *   • **ناوبریِ درون‌صفحه‌ای**: نوارِ لنگر به‌جای تب انتخاب شده تا بدونِ JS کار کند و
 *     لینک‌های مستقیمِ `#resume-settings`، `#providers` و `#targeting` پایدار بمانند.
 *   • **اسکلتِ هم‌شکل**: اسکلت، ترتیب و ابعادِ هر چهار بخش را تقلید می‌کند تا هنگام
 *     استریم‌شدن داده، صفحه جابه‌جاییِ محسوس نداشته باشد.
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

import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import { getDashboardUser } from "@/components/dashboard/session";
import { IconPlug, IconSparkle, IconTarget, IconUpload, IconUser } from "@/components/dashboard/icons";
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

/** بخش‌های صفحه — منبعِ حقیقتِ نوارِ لنگر و عنوان‌ها (تا از هم جدا نیفتند). */
const SECTIONS = [
  { id: "resume", label: "رزومه و پروفایلِ کارجو", icon: IconUser },
  { id: "resume-settings", label: "تنظیم‌های ساخت رزومه", icon: IconSparkle },
  { id: "providers", label: "پروفایل سایت‌های کاریابی", icon: IconPlug },
  { id: "targeting", label: "هدف‌گیری شغل‌ها", icon: IconTarget },
] as const;

export default async function ProfilesPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="پروفایل‌ها و تنظیم‌ها"
        subtitle="اطلاعات رزومه، دامنه‌های تخصصی و پروفایل هر سایت کاریابی از یک محل مدیریت می‌شود."
      />

      <Suspense fallback={<ProfilesSkeleton />}>
        <ProfilesSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── ناوبریِ درون‌صفحه ───────────────────────── */

/**
 * پرش بینِ بخش‌های بلندِ صفحه. لنگرِ ساده (نه تب) چون بدونِ JS کار می‌کند، لینکِ مستقیم
 * می‌دهد و همه‌ی بخش‌ها برای Ctrl+F در DOM می‌مانند. `aria-current` عمداً نیامده: بخشِ فعال
 * فقط سمتِ کلاینت (اسکرول) معلوم می‌شود و ادعای ثابتِ سرور دروغ می‌بود.
 */
function SectionNav() {
  return (
    <nav aria-label="بخش‌های این صفحه" className="flex flex-wrap gap-2">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-foreground"
          >
            <Icon className="h-4 w-4" />
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ProfilesSection({ userId }: { userId: string }) {
  const [profile, files, costCtx, jobinjaSnapshot, resumeSettings, providers] = await Promise.all([
    getFullResumeProfile(userId),
    getResumeFileList(userId),
    getUserAiCostContext(userId),
    getProfileSnapshot(userId, "jobinja"),
    readResumeSettings(userId),
    getProviderProfiles(userId),
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

  const snapshotData = (jobinjaSnapshot?.data as Record<string, unknown> | undefined) ?? {};

  // کاربرِ تازه: نه پروفایلی ساخته، نه فایلی آپلود کرده ⇒ باید یک کارِ روشن ببیند.
  const isBlank = profile === null && files.length === 0;

  return (
    <div className="space-y-8">
      <SectionNav />

      <section id="resume" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-extrabold tracking-tight">
          {SECTIONS[0].label}
        </h2>

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
      </section>

      <section id="resume-settings" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-extrabold tracking-tight">
          {SECTIONS[1].label}
        </h2>
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
      </section>

      <section id="providers" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-extrabold tracking-tight">
          {SECTIONS[2].label}
        </h2>
        <ProviderProfilesGrid providers={providers} />
        <div className="max-w-2xl">
          <JobinjaProfileEdit
            initialJobTitle={pick(snapshotData, "headline", "jobTitle", "job_title", "title")}
            initialFullName={pick(snapshotData, "fullName", "full_name", "name")}
          />
        </div>
      </section>

      <section id="targeting" className="scroll-mt-24 space-y-4">
        <h2 className="text-lg font-extrabold tracking-tight">
          {SECTIONS[3].label}
        </h2>
        <ProviderTargetingSection userId={userId} />
      </section>
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

/* ───────────────────────── اسکلتِ هم‌شکلِ محتوا ───────────────────────── */

/**
 * ساختارِ `ProfilesSection` را تقلید می‌کند تا با آمدنِ داده پرشِ چیدمانی رخ ندهد:
 * نوارِ لنگر، فضای کارِ رزومه، تنظیم‌ها، چهار پروفایل provider و هدف‌گیری.
 */
function ProfilesSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      {/* نوارِ لنگر */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-44 rounded-full" />
        <Skeleton className="h-10 w-36 rounded-full" />
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-10 w-36 rounded-full" />
      </div>

      {/* بخشِ رزومه: عنوان + شبکه‌ی ۳/۲ (هم‌شکلِ ResumeWorkspace) */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-52" />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            {Array.from({ length: 2 }).map((_, c) => (
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
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-4 h-32 w-full rounded-2xl" />
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
              <Skeleton className="h-5 w-44" />
              <SkeletonText lines={4} className="mt-4" />
            </div>
          </div>
        </div>
      </div>

      {/* تنظیم‌های رزومه */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-44" />
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <SkeletonText lines={6} />
        </div>
      </div>

      {/* پروفایل providerها */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-52" />
        <div className="grid gap-5 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-border bg-card p-6 shadow-xs">
              <Skeleton className="h-5 w-40" />
              <SkeletonText lines={4} className="mt-4" />
            </div>
          ))}
        </div>
      </div>

      {/* هدف‌گیری */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}
