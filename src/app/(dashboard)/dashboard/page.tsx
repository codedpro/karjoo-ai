/**
 * خانه‌ی داشبورد (server component) — gate شده با نشست.
 *
 * اگر نشستِ معتبر نباشد → redirect به /login. در غیرِ این صورت: خوشامد + کارت‌های
 * خلاصه + بهترین تطبیق‌ها + پنلِ اتصالِ افزونه. بخش‌های وابسته به DB در Suspense
 * پیچیده شده‌اند تا پوسته فوراً نمایش داده شود (streaming).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import {
  getDashboardCounts,
  getMatchesForUser,
  getProfileForUser,
} from "@/components/dashboard/data";
import { MatchCard } from "@/components/dashboard/match-card";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { getDashboardUser } from "@/components/dashboard/session";
import { Card, EmptyState, SectionHeading, Skeleton, toFaDigits } from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "داشبورد",
  robots: { index: false, follow: false },
};

export default async function DashboardHomePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="home">
      <Suspense fallback={<HeadingSkeleton />}>
        <Welcome userId={user.userId} fallbackName={user.fullName} />
      </Suspense>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">بهترین تطبیق‌های شما</h2>
            <Link
              href="/dashboard/matches"
              className="text-sm font-medium text-brand hover:underline"
            >
              مشاهده‌ی همه
            </Link>
          </div>
          <Suspense fallback={<MatchesSkeleton />}>
            <TopMatches userId={user.userId} />
          </Suspense>
        </div>

        <div className="space-y-6">
          <PairExtensionPanel />
        </div>
      </div>
    </DashboardShell>
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
    <div>
      <SectionHeading
        title={`سلام، ${name} 👋`}
        subtitle="آخرین وضعیتِ تطبیق‌ها و اپلای‌هایت را اینجا دنبال کن."
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon="✅"
          value={counts.drafted}
          label="تطبیقِ آماده‌ی اپلای"
          tone="brand"
        />
        <SummaryCard
          icon="🎯"
          value={counts.totalMatches}
          label="تطبیق‌های بررسی‌شده"
          tone="accent"
          href="/dashboard/matches"
        />
        <SummaryCard
          icon="📨"
          value={counts.totalApplications}
          label="اپلای‌های ثبت‌شده"
          tone="muted"
          href="/dashboard/applications"
        />
      </div>
    </div>
  );
}

async function TopMatches({ userId }: { userId: string }) {
  const matches = await getMatchesForUser(userId, 4);

  if (matches.length === 0) {
    return (
      <EmptyState
        icon="🧭"
        title="هنوز تطبیقی نداریم"
        body="به‌محض اینکه پروفایلت با آگهی‌های تازه تطبیق داده شود، بهترین فرصت‌ها همین‌جا ظاهر می‌شوند."
      />
    );
  }

  return (
    <div className="space-y-4">
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
    </div>
  );
}

/* ─────────────────────────────── اجزای کوچک ────────────────────────────────── */

function SummaryCard({
  icon,
  value,
  label,
  tone,
  href,
}: {
  icon: string;
  value: number | string;
  label: string;
  tone: "brand" | "accent" | "muted";
  href?: string;
}) {
  const toneRing =
    tone === "brand"
      ? "bg-brand/10"
      : tone === "accent"
        ? "bg-accent/10"
        : "bg-foreground/5";

  const inner = (
    <Card className="flex items-center gap-4 p-5 transition-colors hover:border-brand/40">
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl ${toneRing}`}>
        {icon}
      </div>
      <div>
        <div className="ltr-nums text-2xl font-extrabold">
          {typeof value === "number" ? toFaDigits(value) : value}
        </div>
        <div className="text-xs text-muted">{label}</div>
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function HeadingSkeleton() {
  return (
    <div>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  );
}

function MatchesSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
    </div>
  );
}
