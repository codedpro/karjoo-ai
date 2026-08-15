/**
 * خانه‌ی داشبورد (Server component) — الگوی مرجعِ همه‌ی صفحه‌های داشبورد.
 *
 * قاعده‌ی محتوایی این صفحه: کاربرِ تازه‌وارد باید در یک نگاه بفهمد «الان چه خبر است» و
 * «قدمِ بعدی‌ام چیست» — نه اینکه با چهار عددِ هم‌معنی روبه‌رو شود. بنابراین:
 *   • ردیفِ آمار فقط سه عددِ *واقعاً متمایز* دارد (نوبتِ ارسال / ارسالِ امروز / کلِ ارسال‌ها)؛
 *     عددِ «۳۰ روزِ اخیر» به‌جای کارتِ چهارم، به‌عنوانِ زمینه زیرِ «ارسالِ امروز» می‌نشیند.
 *   • بلوکِ پایینِ صفحه دیگر یک هدرِ بی‌بدنه با دو دکمه‌ی تکراریِ ناوبری نیست؛ کارت‌های
 *     «قدمِ بعدی» است که *از روی داده‌ی خودِ کاربر* نوشته می‌شوند (نوبتِ خالی ⇄ نوبتِ پر).
 *
 * الگوی Next 16 که این صفحه نشان می‌دهد:
 *   • پوسته (هدر/ناوبری) در `dashboard/layout.tsx` استاتیک و فوری است — این صفحه فقط
 *     محتوا می‌دهد، و هیچ کانتینرِ عرضِ خودش نمی‌سازد (`.dash-container` در layout است).
 *   • حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط `userId` را
 *     می‌گیریم (راستی‌آزماییِ کامل در session/چیپِ کاربر است).
 *   • هر بخشِ وابسته به DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود.
 *   • `getDashboardCounts` با `cache()` پوشیده است؛ پس دو بخشِ مستقل (آمار و قدمِ بعدی)
 *     می‌توانند جدا استریم شوند بدونِ اینکه کوئری دو بار اجرا شود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { AiMaintenanceBanner } from "@/components/dashboard/ai-maintenance-banner";
import {
  getDashboardCounts,
  getProfileForUser,
} from "@/components/dashboard/data";
import {
  LiveApplyPanel,
  LiveApplyPanelSkeleton,
} from "@/components/dashboard/live-apply-panel";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { getDashboardUser } from "@/components/dashboard/session";
import { getLiveApplyOverview } from "@/lib/apply/live-overview";
import {
  IconBolt,
  IconChevronEnd,
  IconDoc,
  IconHand,
  IconSend,
  IconTarget,
} from "@/components/dashboard/icons";
import {
  Card,
  PageHeader,
  SectionHeading,
  Skeleton,
  SkeletonStat,
  StatCard,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "داشبورد",
  robots: { index: false, follow: false },
};

export default async function DashboardHomePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;
  const fallbackName = user.fullName ?? user.name;

  return (
    <div className="space-y-8">
      {/* بنرِ نگه‌داریِ هوش مصنوعی — فقط در حالتِ نگه‌داری دیده می‌شود. */}
      <div className="empty:hidden">
        <AiMaintenanceBanner />
      </div>

      {/* چک‌لیستِ «شروعِ کار» — استریم؛ اگر همه‌ی گام‌ها کامل باشد چیزی رندر نمی‌شود. */}
      <Suspense fallback={<Skeleton className="h-28 w-full rounded-2xl" />}>
        <OnboardingChecklist userId={userId} />
      </Suspense>

      {/* خوشامد + کارت‌های آمار (استریم؛ اسکلتِ هم‌شکلِ StatCard) */}
      <section>
        <Suspense fallback={<WelcomeSkeleton />}>
          <Welcome userId={userId} fallbackName={fallbackName} />
        </Suspense>
      </section>

      <Suspense fallback={<LiveApplyPanelSkeleton />}>
        <LiveSection userId={userId} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="space-y-4 xl:col-span-2">
          <SectionHeading
            as="h2"
            title="قدمِ بعدی"
            subtitle="بر اساسِ وضعیتِ همین حالای حسابت."
          />
          <Suspense fallback={<NextStepsSkeleton />}>
            <NextSteps userId={userId} />
          </Suspense>
        </section>

        <aside className="space-y-6">
          <PairExtensionPanel />
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function Welcome({
  userId,
  fallbackName,
}: {
  userId: string;
  fallbackName: string | null;
}) {
  const [profile, counts] = await Promise.all([
    getProfileForUser(userId),
    getDashboardCounts(userId),
  ]);

  const name = profile?.fullName ?? fallbackName ?? "کاربر کارجو";

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            <IconHand className="h-6 w-6 text-brand" />
            سلام، <span className="text-brand">{name}</span>
          </span>
        }
        subtitle="این‌جا می‌بینی کارجو چه چیزی برایت فرستاده و چه چیزی در راه است."
      />

      {/* سه عددِ متمایز؛ عددِ «۳۰ روزِ اخیر» به‌عنوانِ زمینه، نه کارتِ جداگانه. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          icon={<IconSend className="h-5 w-5" />}
          value={counts.queued}
          label="در نوبتِ ارسال"
          hint="آگهی‌هایی که منتظرِ ارسال به کارفرما هستند"
          tone="brand"
          href="/dashboard/interview-prep"
        />
        <StatCard
          icon={<IconBolt className="h-5 w-5" />}
          value={counts.appliedToday}
          label="ارسالِ امروز"
          hint={`در ۳۰ روزِ اخیر: ${toFaDigits(counts.appliedLast30d)} ارسال`}
          tone="accent"
          href="/dashboard/archive"
        />
        <StatCard
          icon={<IconTarget className="h-5 w-5" />}
          value={counts.appliedTotal}
          label="کلِ ارسال‌ها"
          hint="از روزی که به کارجو پیوستی"
          tone="muted"
          href="/dashboard/archive"
        />
      </div>
    </div>
  );
}

async function LiveSection({ userId }: { userId: string }) {
  const overview = await getLiveApplyOverview(userId, {
    queueLimit: 40,
    recentLimit: 30,
  });
  return <LiveApplyPanel initialData={overview} />;
}

/* ───────────────────────────  کارت‌های «قدمِ بعدی»  ─────────────────────────── */

interface NextStep {
  key: string;
  icon: ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
}

/**
 * سه کارتِ «الان چه کار کنم؟». دو کارتِ اول از روی وضعیتِ واقعیِ حساب نوشته می‌شوند
 * (نوبتِ ارسالِ پر ⇄ خالی، اولین ارسال انجام شده یا نه) تا صرفاً تکرارِ لینک‌های
 * ناوبری نباشند. `getDashboardCounts` کش‌شده است؛ پس این‌جا کوئریِ تازه‌ای نمی‌زند.
 */
async function NextSteps({ userId }: { userId: string }) {
  const counts = await getDashboardCounts(userId);

  const steps: NextStep[] = [
    counts.queued > 0
      ? {
          key: "queue",
          icon: <IconSend className="h-5 w-5" />,
          title: `${toFaDigits(counts.queued)} آگهی در نوبتِ ارسال است`,
          body: "ببین همین حالا چه چیزی فرستاده می‌شود و نتیجه‌ی هرکدام چه بوده.",
          href: "/dashboard/interview-prep",
          cta: "دیدنِ وضعیتِ اپلای‌ها",
        }
      : {
          key: "queue",
          icon: <IconBolt className="h-5 w-5" />,
          title: "نوبتِ ارسال خالی است",
          body: "شرط‌های اپلای خودکار را تنظیم کن تا آگهی‌های تازه خودشان وارد نوبت شوند.",
          href: "/dashboard/auto-apply",
          cta: "تنظیمِ اپلای خودکار",
        },
    {
      key: "matches",
      icon: <IconTarget className="h-5 w-5" />,
      title: "فرصت‌های شغلیِ پیشنهادی",
      body: "آگهی‌هایی که به تو می‌خورند را ببین و هرکدام را خواستی خودت بفرست.",
      href: "/dashboard/matches",
      cta: "دیدنِ فرصت‌ها",
    },
    counts.appliedTotal > 0
      ? {
          key: "resume",
          icon: <IconDoc className="h-5 w-5" />,
          title: "رزومه‌ات را تازه نگه دار",
          body: "همین اطلاعات است که با هر ارسال به دستِ کارفرما می‌رسد.",
          href: "/dashboard/profiles",
          cta: "رزومه و پروفایل",
        }
      : {
          key: "resume",
          icon: <IconDoc className="h-5 w-5" />,
          title: "رزومه‌ات را کامل کن",
          body: "تا رزومه کامل نباشد، ارسالِ خودکار چیزی برای فرستادن ندارد.",
          href: "/dashboard/profiles",
          cta: "تکمیلِ رزومه",
        },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {steps.map((step) => (
        <Link
          key={step.key}
          href={step.href}
          className="focus-ring block rounded-2xl"
        >
          <Card padded interactive className="h-full">
            <span
              className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand"
              aria-hidden
            >
              {step.icon}
            </span>
            <h3 className="mt-4 text-balance text-base font-bold leading-6">
              {step.title}
            </h3>
            <p className="mt-1.5 text-pretty text-sm leading-6 text-muted">
              {step.body}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
              {step.cta}
              <IconChevronEnd className="h-4 w-4" />
            </span>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/* ─────────────────────────── اسکلت‌های هم‌شکل ─────────────────────────── */

function WelcomeSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonStat />
        <SkeletonStat />
        <SkeletonStat />
      </div>
    </div>
  );
}

/** اسکلتِ کارت‌های «قدمِ بعدی» — همان گریدِ سه‌تایی با ارتفاعِ نزدیک به کارتِ واقعی. */
function NextStepsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-48 rounded-2xl" />
      ))}
    </div>
  );
}
