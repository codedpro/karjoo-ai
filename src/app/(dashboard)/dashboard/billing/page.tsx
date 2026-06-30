/**
 * نمای «کیف‌پول و صورتحساب» (server component) — gate شده با نشست.
 *
 * موجودیِ کیف‌پول (تومان) + نشانِ پلن + CTAِ شارژ (stubِ توسعه‌ای)، فهرستِ تراکنش‌های
 * کیف‌پول، و جدولِ تاریخچه‌ی مصرفِ هوش مصنوعی با هزینه‌ی هر فراخوانی.
 *
 * داده مستقیم از DB (RSC) و مقید به userIdِ نشست خوانده می‌شود (قاعده‌ی ۴: دادهٔ هر
 * کاربر فقط برای همان کاربر). بخش‌های وابسته به DB در Suspense‌اند تا پوسته فوراً بیاید.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getDashboardUser } from "@/components/dashboard/session";
import { getUsageForUser, getWalletForUser } from "@/components/dashboard/wallet-data";
import { LedgerList, UsageTable } from "@/components/dashboard/wallet-history";
import { WalletPanel } from "@/components/dashboard/wallet-panel";
import { SectionHeading, Skeleton } from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "کیف‌پول و صورتحساب",
  robots: { index: false, follow: false },
};

export default async function BillingPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="billing">
      <SectionHeading
        title="کیف‌پول و صورتحساب"
        subtitle="موجودیِ خود را مدیریت کنید و هزینه‌ی هر فراخوانیِ هوش مصنوعی را ببینید. آپلودِ رزومه و استخراجِ متن همیشه رایگان است؛ تطبیق، انگیزه‌نامه و پردازشِ هوشمندِ رزومه به‌میزانِ مصرف از کیف‌پول کسر می‌شوند."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* ستونِ کیف‌پول + تراکنش‌ها */}
        <div className="space-y-6">
          <Suspense fallback={<Skeleton className="h-72" />}>
            <WalletSection userId={user.userId} />
          </Suspense>
        </div>

        {/* ستونِ تاریخچه‌ی مصرف */}
        <div className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-bold">تاریخچه‌ی مصرفِ هوش مصنوعی</h2>
          <Suspense fallback={<UsageSkeleton />}>
            <UsageSection userId={user.userId} />
          </Suspense>
        </div>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function WalletSection({ userId }: { userId: string }) {
  const wallet = await getWalletForUser(userId, 10);
  return (
    <>
      <WalletPanel initialBalanceToman={wallet.balanceToman} plan={wallet.plan} />
      <LedgerList entries={wallet.ledger} />
    </>
  );
}

async function UsageSection({ userId }: { userId: string }) {
  const usage = await getUsageForUser(userId, 30);
  return <UsageTable rows={usage} />;
}

function UsageSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}
