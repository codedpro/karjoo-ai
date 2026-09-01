/**
 * نمای «اپلای خودکار» (Server component) — یک صفحه، سه پرسشِ کاربر:
 *
 *   ۱) «دنبالِ چه شغلی هستم؟» — شرط‌های کشف (شهر/زمینه/دورکاری) + سقفِ روزانه + مکث،
 *      و کارتِ اختیاریِ امتیازدهیِ هوش مصنوعی. مسیرِ پیش‌فرض بدونِ AI کار می‌کند.
 *   ۲) «بدونِ مرورگر هم ارسال شود؟» — اجرای شبانه‌روزی روی سرورهای کارجو. اگر اشتراکِ
 *      کاربر این را ندارد، *فقط یک* کارتِ ارتقا دیده می‌شود (نه تاگلِ بی‌اثر، نه دو کارتِ
 *      ارتقای پشتِ‌سرِ‌هم) و پنلِ سرورها اصلاً رندر نمی‌شود.
 *   ۳) «الان چه وضعی است؟» — ردیفِ پایین: افزونه‌ی مرورگر، سقفِ ارسالِ امروز، تاریخچه.
 *
 * تصمیم‌های این بازنویسی:
 *   • هر سرسطر حداکثر *یک جمله* دارد؛ هرچه بیشتر بود یا حذف شد یا به `Callout` رفت.
 *     بلندیِ متن نشانه‌ی گویانبودنِ UI است، نه راه‌حلِ آن.
 *   • واژگانِ داخلی («ناوگان»، «ردِ ممیزی»، «آستانه»، نامِ پلن) از متنِ کاربر بیرون رفت.
 *   • سه پنلِ پایین پیش‌تر هرکدام جدا `getAutoApplyDashboardData` را صدا می‌زدند (سه
 *     Suspense، یک داده). حالا یک بخشِ واحد یک بار می‌خواند و هر سه را می‌سازد؛ خودِ
 *     data-helper هم `cache()` است، پس حتی با فراخوانیِ چندباره کوئری تکرار نمی‌شود.
 *   • عرضِ صفحه سیّال است (`.dash-container` در layout): پنل‌های مستقل در `xl:` کنارِ هم
 *     می‌نشینند تا صفحه روی نمایشگرِ پهن یک ستونِ بلند نباشد.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `layout.tsx` استاتیک است؛ این صفحه فقط محتوا
 * می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. حضورِ نشست پیش‌تر در `proxy.ts` چک
 * شده؛ این‌جا فقط `userId` را می‌گیریم. هر بخشِ وابسته به DB در `<Suspense>` با اسکلتِ
 * هم‌شکلِ محتوا استریم می‌شود. داده مقید به userIdِ نشست (قاعده‌ی ۴).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getAutoApplyDashboardData } from "@/components/dashboard/auto-apply-data";
import { getServerAutoApplyCardData } from "@/components/dashboard/server-auto-apply-data";
import { ServerAutoApplyToggle } from "@/components/dashboard/server-auto-apply-toggle";
import {
  AiFilterCardSkeleton,
  AiFilterToggleCard,
} from "@/components/dashboard/ai-filter-card";
import {
  ApplyFiltersEditor,
  type InitialApplyFilters,
} from "@/components/dashboard/apply-filters-editor";
import {
  ApplyUsagePanel,
  AutoApplyAuditPanel,
  ExtensionApplyPanel,
} from "@/components/dashboard/auto-apply-panels";
import { FleetStatusPanel } from "@/components/dashboard/fleet-status-panel";
import { getFleetStatusData } from "@/components/dashboard/fleet-status-data";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  PageHeader,
  Skeleton,
  SkeletonCard,
  SkeletonList,
} from "@/components/dashboard/ui";
import { IconServer, IconPuzzle, IconArrowEnd } from "@/components/dashboard/icons";
import { buildSearchUrl } from "@/lib/apply/boards/jobinja";
import { getJobinjaCategories } from "@/lib/apply/boards/jobinja-categories";
import { readApplyFilters, toJobPreferences } from "@/lib/apply/filters";
import type { CategoryOption } from "@/lib/apply/apply-filters-form";
import {
  InterestsPickerSection,
  InterestsPickerSkeleton,
} from "@/components/dashboard/interests-section";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (بدونِ force-dynamic؛ استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اپلای خودکار",
  robots: { index: false, follow: false },
};

export default async function AutoApplyPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;

  return (
    <div className="space-y-10">
      <PageHeader
        title="اپلای خودکار"
        subtitle="این‌جا تعیین می‌کنی کارجو دنبالِ چه شغلی بگردد و با چه سرعتی به‌جای تو درخواست بفرستد."
      />

      {/* ══════════ ۱ — زمینه‌های شغلی ══════════ */}
      {/* پیش‌تر صفحه‌ی جدایی بود. هر دو بخش یک کلید را می‌نویسند (categorySlugs)، پس
          کنارِ هم بودنشان تنها راهی است که کاربر ببیند دارد چه چیزی را جایگزین می‌کند. */}
      <section className="space-y-4">
        <LevelHeading
          icon="puzzle"
          eyebrow="گامِ اول"
          title="دنبالِ چه نوع کاری هستی؟"
          subtitle="زمینه‌هایی که انتخاب می‌کنی، همان‌هایی است که کارجو در سایت‌ها دنبالشان می‌گردد."
        />
        <Suspense fallback={<InterestsPickerSkeleton />}>
          <InterestsPickerSection userId={userId} />
        </Suspense>
      </section>

      {/* ══════════ ۲ — شرط‌های ارسال ══════════ */}
      <section className="space-y-4">
        <LevelHeading
          icon="puzzle"
          eyebrow="گامِ دوم"
          title="کجا، با چه شرایطی، و با چه سرعتی؟"
          subtitle="شهر، دورکاری، نوعِ همکاری و سقفِ ارسالِ روزانه."
        />
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <Suspense fallback={<EditorSkeleton />}>
              <FiltersSection userId={userId} />
            </Suspense>
          </div>
          <div className="min-w-0">
            <Suspense fallback={<AiFilterCardSkeleton />}>
              <AiFilterToggleCard userId={userId} />
            </Suspense>
          </div>
        </div>
      </section>

      {/* ══════════ ۳ — ارسال بدونِ مرورگرِ باز ══════════ */}
      <section className="space-y-4">
        <LevelHeading
          icon="server"
          eyebrow="ارسالِ شبانه‌روزی"
          title="حتی وقتی مرورگرت بسته است"
          subtitle="کارجو روی سرورهای خودش و با حسابِ خودت درخواست می‌فرستد."
        />
        <Suspense fallback={<ToggleSkeleton />}>
          <ServerSection userId={userId} />
        </Suspense>
      </section>

      {/* ══════════ ۴ — وضعیتِ فعلی (یک کوئری، سه پنل) ══════════ */}
      <section>
        <Suspense fallback={<StatusRowSkeleton />}>
          <StatusRow userId={userId} />
        </Suspense>
      </section>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

/**
 * سطحِ «ارسالِ شبانه‌روزی». اگر اشتراکِ کاربر این قابلیت را ندارد، فقط کارتِ ارتقا
 * رندر می‌شود و پنلِ سرورها اصلاً ساخته نمی‌شود — پیش‌تر کاربرِ Free دو کارتِ ارتقای
 * پشتِ‌سرِ‌هم می‌دید.
 */
async function ServerSection({ userId }: { userId: string }) {
  const data = await getServerAutoApplyCardData(userId);

  if (!data.capability.hasWorkerAutoApply) {
    return (
      <Card padded>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-foreground/5 text-muted"
              aria-hidden
            >
              <IconServer className="h-5 w-5" />
            </span>
            <h3 className="text-balance text-base font-bold leading-tight">
              ارسال بدونِ مرورگرِ باز
            </h3>
          </div>
          <Badge tone="accent">نیازمندِ ارتقا</Badge>
        </div>

        <p className="mt-3 text-pretty text-sm leading-7 text-muted">
          با اشتراکِ فعلی‌ات (
          <strong className="font-semibold text-foreground">
            {data.capability.planLabelFa}
          </strong>
          ) درخواست‌ها فقط وقتی فرستاده می‌شوند که مرورگرت باز و افزونه روشن باشد.
        </p>

        <Callout
          tone="info"
          className="mt-4"
          action={
            <ButtonLink href="/dashboard/plans" size="sm">
              دیدنِ اشتراک‌ها
              <IconArrowEnd className="h-4 w-4" />
            </ButtonLink>
          }
        >
          با ارتقا، کارجو شب‌ها و وقتی سرِ کاری هم به‌جای تو درخواست می‌فرستد.
        </Callout>
      </Card>
    );
  }

  // اشتراکِ واجدِ شرایط — تاگلِ کامل + وضعیتِ سرورها در کنارش.
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">
        <ServerAutoApplyToggle
          initialEnabled={data.settings.enabled}
          initialMinScore={data.settings.minScore}
        />
      </div>
      <div className="min-w-0">
        <Suspense fallback={<SkeletonCard className="h-56" />}>
          <FleetSection userId={userId} />
        </Suspense>
      </div>
    </div>
  );
}

async function FleetSection({ userId }: { userId: string }) {
  // وضعیتِ سرورهای تخصیص‌یافته + تازگیِ نشست (فقط برای اشتراک‌های واجدِ شرایط).
  const data = await getFleetStatusData(userId);
  return <FleetStatusPanel data={data} />;
}

/**
 * ردیفِ وضعیت — افزونه، سقفِ امروز و تاریخچه. هر سه از *یک* بسته‌ی داده ساخته می‌شوند
 * (پیش‌تر سه بخشِ جدا بودند که هرکدام همان تابع را صدا می‌زدند).
 */
async function StatusRow({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="min-w-0">
        <ExtensionApplyPanel boards={data.boards} />
      </div>
      <div className="min-w-0">
        <ApplyUsagePanel apply={data.apply} />
      </div>
      <div className="min-w-0">
        <AutoApplyAuditPanel audit={data.audit} />
      </div>
    </div>
  );
}

async function FiltersSection({ userId }: { userId: string }) {
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
    paused: filters.paused,
    ...(filters.dailyLimit === undefined ? {} : { dailyLimit: filters.dailyLimit }),
    ...(filters.weeklyLimit === undefined ? {} : { weeklyLimit: filters.weeklyLimit }),
  };

  const initialPreviewUrl = buildSearchUrl(
    toJobPreferences({
      categorySlugs: initialFilters.categorySlugs,
      cities: initialFilters.cities,
      jobTypes: initialFilters.jobTypes,
      remoteOnly: initialFilters.remoteOnly,
      ...(initialFilters.minSalary === undefined ? {} : { minSalary: initialFilters.minSalary }),
      ...(initialFilters.sort === undefined ? {} : { sort: initialFilters.sort }),
      paused: initialFilters.paused === true,
      ...(initialFilters.dailyLimit === undefined ? {} : { dailyLimit: initialFilters.dailyLimit }),
      ...(initialFilters.weeklyLimit === undefined ? {} : { weeklyLimit: initialFilters.weeklyLimit }),
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

/* ─────────────────────────  سرسطرِ سطح (با ابرو)  ───────────────────────── */

/**
 * سرسطرِ هر بخش — ابروی کوچکِ رنگی (آیکن + برچسب) روی عنوان و *یک* جمله‌ی توضیح.
 * زیرعنوان اختیاری است تا بخش‌هایی که خودشان گویا هستند مجبور به توضیح نشوند.
 */
function LevelHeading({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: "server" | "puzzle";
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  const Icon = icon === "server" ? IconServer : IconPuzzle;
  return (
    <div className="max-w-2xl">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
        <Icon className="h-3.5 w-3.5" />
        {eyebrow}
      </span>
      <h2 className="mt-2.5 text-balance text-xl font-extrabold tracking-tight sm:text-2xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-2 text-pretty text-sm leading-7 text-muted">{subtitle}</p>
      ) : null}
    </div>
  );
}

/* ─────────────────── اسکلت‌های هم‌شکلِ محتوا (نه بلاکِ خالی) ─────────────────── */

/** اسکلتِ سطحِ ارسالِ شبانه‌روزی — کارتِ تاگل (۲/۳) + کارتِ وضعیتِ سرورها (۱/۳). */
function ToggleSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-3" aria-hidden>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs xl:col-span-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
        </div>
        <div className="mt-6 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-6 w-12 rounded-full" />
          </div>
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
        </div>
      </div>
      <SkeletonCard className="h-56" />
    </div>
  );
}

/** اسکلتِ ردیفِ وضعیت — سه کارتِ هم‌عرض (افزونه / سقفِ امروز / تاریخچه). */
function StatusRowSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-3" aria-hidden>
      <SkeletonCard className="h-64" />
      <SkeletonCard className="h-56" />
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-3.5 w-3/4" />
        <SkeletonList rows={2} className="mt-5" />
      </div>
    </div>
  );
}

/** اسکلتِ ویرایشگرِ شرط‌ها — نوارِ اکشن + کارتِ پیش‌نمایش + کارتِ فرم. */
function EditorSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-32 rounded-full" />
      </div>
      <div className="rounded-2xl border border-brand/30 bg-brand/[0.06] p-6">
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
