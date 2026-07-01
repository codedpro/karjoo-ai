/**
 * نمای «اپلای خودکار» (Server component) — دو سطحِ *مستقل* (GOAL 3):
 *
 *   ۱) «اپلای خودکار روی سرور (Max/Max+)» — تاگلِ سطحِ سرور/پَسیو. اجرای ۲۴ ساعته روی
 *      ناوگانِ کارجو بدونِ نیاز به مرورگر. برای Max/Max+ یک تاگلِ کامل + وضعیتِ ناوگان؛
 *      برای Free/Pro دعوت به ارتقا (بدونِ تاگلِ کارآمد).
 *   ۲) «اپلای خودکار در مرورگر (افزونه)» — سطحِ مرورگر که در خودِ افزونه روشن می‌شود و در
 *      مرورگرِ کاربر اجرا می‌گردد. برای همه‌ی پلن‌ها؛ این‌جا فقط توضیح + لینک به صفحه‌ی افزونه.
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
import { BrowserAutoApplyPanel } from "@/components/dashboard/browser-auto-apply-panel";
import {
  ApplyUsagePanel,
  AutoApplyAuditPanel,
  BoardReadinessPanel,
} from "@/components/dashboard/auto-apply-panels";
import { FleetStatusPanel } from "@/components/dashboard/fleet-status-panel";
import { getFleetStatusData } from "@/components/dashboard/fleet-status-data";
import {
  Badge,
  Card,
  PageHeader,
  SkeletonCard,
  SkeletonList,
} from "@/components/dashboard/ui";
import { IconServer, IconPuzzle } from "@/components/dashboard/icons";

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
        subtitle="کارجو دو راهِ مستقل برای اپلای خودکار دارد: روی سرورهای خودمان (۲۴ ساعته، ویژه‌ی Max/Max+) یا در مرورگرِ خودتان با افزونه. هر دو پیش‌فرض خاموش‌اند و هر لحظه قابلِ لغو."
      />

      {/* ══════════ سطحِ ۱ — اپلای خودکار روی سرور (Max/Max+) ══════════ */}
      <section className="space-y-4">
        <LevelHeading
          icon="server"
          eyebrow="سطحِ سرور"
          title="اپلای خودکار روی سرور (پلن Max/Max+)"
          subtitle="ناوگانِ کارجو ۲۴ ساعته و بدونِ نیاز به بازبودنِ مرورگر، با نشستِ رمزشده‌ی خودتان اپلای می‌کند."
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Suspense fallback={<ToggleSkeleton />}>
              <ServerControlSection userId={userId} />
            </Suspense>
          </div>
          <div className="space-y-6">
            <Suspense fallback={<SkeletonCard className="h-56" />}>
              <FleetSection userId={userId} />
            </Suspense>
            <Suspense fallback={<SkeletonCard className="h-40" />}>
              <UsageSection userId={userId} />
            </Suspense>
          </div>
        </div>
      </section>

      {/* ══════════ سطحِ ۲ — اپلای خودکار در مرورگر (افزونه) ══════════ */}
      <section className="space-y-4">
        <LevelHeading
          icon="puzzle"
          eyebrow="سطحِ مرورگر"
          title="اپلای خودکار در مرورگر (افزونه)"
          subtitle="برای همه‌ی پلن‌ها؛ در خودِ افزونه روشن می‌شود و در مرورگرِ خودتان اجرا می‌گردد."
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BrowserAutoApplyPanel />
          </div>
          <div className="space-y-6">
            <Suspense fallback={<SkeletonCard className="h-44" />}>
              <BoardsSection userId={userId} />
            </Suspense>
          </div>
        </div>
      </section>

      {/* ══════════ ردِ ممیزیِ مشترک ══════════ */}
      <section>
        <Suspense fallback={<AuditSkeleton />}>
          <AuditSection userId={userId} />
        </Suspense>
      </section>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

/** کارتِ کنترلِ سطحِ سرور: Max/Max+ → تاگل؛ Free/Pro → دعوت به ارتقا. */
async function ServerControlSection({ userId }: { userId: string }) {
  const data = await getServerAutoApplyCardData(userId);

  if (!data.capability.hasWorkerAutoApply) {
    // Free/Pro — واجدِ شرایطِ سطحِ سرور نیستند؛ کارتِ ارتقا (به‌جای تاگل).
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
              اپلای خودکارِ سرور
            </h3>
          </div>
          <Badge tone="accent">ویژه‌ی Max</Badge>
        </div>
        <p className="mt-3 text-pretty text-sm leading-7 text-muted">
          پلنِ فعلیِ شما (
          <strong className="font-semibold text-foreground">
            {data.capability.planLabelFa}
          </strong>
          ) اپلای خودکارِ سرور ندارد. برای اجرای ۲۴ ساعته و بدونِ افزونه از روی سرورهای
          ایرانیِ کارجو، به پلنِ Max یا Max+ ارتقا دهید. تا آن زمان می‌توانید از اپلای
          خودکار در مرورگر (بخشِ پایین) استفاده کنید.
        </p>
      </Card>
    );
  }

  // Max/Max+ — تاگلِ کامل.
  return (
    <ServerAutoApplyToggle
      initialEnabled={data.settings.enabled}
      initialMinScore={data.settings.minScore}
    />
  );
}

async function FleetSection({ userId }: { userId: string }) {
  // وضعیتِ ناوگان (سرورهای تخصیص‌یافته + تازگیِ نشست)؛ Free/Pro → دعوت به ارتقا.
  const data = await getFleetStatusData(userId);
  return <FleetStatusPanel data={data} />;
}

async function UsageSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <ApplyUsagePanel apply={data.apply} />;
}

async function BoardsSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <BoardReadinessPanel boards={data.boards} />;
}

async function AuditSection({ userId }: { userId: string }) {
  const data = await getAutoApplyDashboardData(userId);
  return <AutoApplyAuditPanel audit={data.audit} />;
}

/* ─────────────────────────  سرسطرِ سطح (با ابرو)  ───────────────────────── */

/** سرسطرِ هر سطح — ابروی کوچکِ رنگی (آیکن + برچسب) روی عنوان/زیرعنوان. */
function LevelHeading({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: "server" | "puzzle";
  eyebrow: string;
  title: string;
  subtitle: string;
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
      <p className="mt-2 text-pretty text-sm leading-7 text-muted">{subtitle}</p>
    </div>
  );
}

/* ─────────────────── اسکلت‌های هم‌شکلِ محتوا (نه بلاکِ خالی) ─────────────────── */

/** اسکلتِ کارتِ تاگل — سرسطر + سوییچ + اسلایدر. */
function ToggleSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2.5">
          <div className="skeleton-shimmer h-5 w-40 rounded-lg bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-full rounded bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-4/5 rounded bg-foreground/[0.06]" />
        </div>
        <div className="skeleton-shimmer h-7 w-12 shrink-0 rounded-full bg-foreground/[0.06]" />
      </div>
      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="flex items-center justify-between">
          <div className="skeleton-shimmer h-4 w-40 rounded bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-6 w-12 rounded-full bg-foreground/[0.06]" />
        </div>
        <div className="skeleton-shimmer mt-4 h-2 w-full rounded-full bg-foreground/[0.06]" />
      </div>
    </div>
  );
}

/** اسکلتِ ردِ ممیزی — چند ردیفِ رویداد. */
function AuditSkeleton() {
  return (
    <div
      className="rounded-2xl border border-border bg-card p-6 shadow-xs"
      aria-hidden
    >
      <div className="skeleton-shimmer h-5 w-44 rounded-lg bg-foreground/[0.06]" />
      <div className="skeleton-shimmer mt-2 h-3.5 w-3/4 rounded bg-foreground/[0.06]" />
      <SkeletonList rows={3} className="mt-5" />
    </div>
  );
}
