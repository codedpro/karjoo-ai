/**
 * نمای «کیف‌پول و صورتحساب» (Server component) — الگوی Next 16 (پوسته‌ی فوری + استریم).
 *
 * موجودیِ کیف‌پولِ *واحدِ 1xAi* (تومان) + نشانِ پلن + لینکِ شارژ در 1xai، فهرستِ
 * تراکنش‌های محلی (تاریخچه)، و جدولِ مصرفِ هوش مصنوعی با هزینه‌ی هر فراخوانی.
 * این صفحه *نمایشی* است: اگر svcِ 1xai در دسترس نباشد، به‌جای موجودیِ جعلی، حالتِ
 * «کیف‌پول موقتاً در دسترس نیست» (unavailable) به پنل پاس می‌شود (تنزلِ نمایشی).
 *
 * الگو: پوسته (هدر/ناوبری) در `dashboard/layout.tsx` استاتیک و فوری است؛ این صفحه فقط
 * محتوا می‌دهد. حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط
 * `userId` را می‌گیریم. هر بخشِ وابسته به DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ
 * محتوا** استریم می‌شود (کارتِ کیف‌پول، جدولِ مصرف) — نه بلاکِ خاکستریِ کلی. داده مقید
 * به userIdِ نشست خوانده می‌شود (قاعده‌ی ۴: دادهٔ هر کاربر فقط برای همان کاربر).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getUsageForUser, getWalletForUser } from "@/components/dashboard/wallet-data";
import { getUnifiedBalance } from "@/lib/billing/unified";
import { LedgerList, UsageTable } from "@/components/dashboard/wallet-history";
import { WalletPanel } from "@/components/dashboard/wallet-panel";
import {
  ButtonLink,
  PageHeader,
  SectionHeading,
  Skeleton,
  SkeletonTable,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (دیگر force-dynamic لازم نیست).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "کیف‌پول و صورتحساب",
  robots: { index: false, follow: false },
};

export default async function BillingPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const { userId } = user;

  return (
    <div className="space-y-8">
      <PageHeader
        title="کیف‌پول و صورتحساب"
        subtitle="کیف‌پولِ تو همان کیف‌پولِ 1xAi است — یک موجودی برای همه‌ی محصولات؛ شارژ از داشبوردِ 1xai انجام می‌شود. آپلودِ رزومه و استخراجِ متن همیشه رایگان است؛ تطبیق، انگیزه‌نامه و پردازشِ هوشمندِ رزومه به‌میزانِ مصرف از همین کیف‌پول کسر می‌شوند."
        actions={
          <ButtonLink href="/dashboard/plans" variant="secondary" size="sm">
            پلن‌ها و ارتقا
          </ButtonLink>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ستونِ کیف‌پول + تراکنش‌ها */}
        <div className="space-y-6 lg:col-span-1">
          <Suspense fallback={<WalletSkeleton />}>
            <WalletSection userId={userId} />
          </Suspense>
        </div>

        {/* ستونِ تاریخچه‌ی مصرف */}
        <div className="lg:col-span-2">
          <SectionHeading
            as="h2"
            title="تاریخچه‌ی مصرفِ هوش مصنوعی"
            subtitle="هزینه‌ی هر فراخوانی — بر اساسِ مصرفِ واقعیِ توکن، از کیف‌پول کسر شده."
          />
          <div className="mt-5">
            <Suspense fallback={<SkeletonTable rows={6} cols={5} />}>
              <UsageSection userId={userId} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function WalletSection({ userId }: { userId: string }) {
  // پلن + دفترِ محلی (تاریخچه) از DB؛ موجودی از کیف‌پولِ واحدِ 1xai — نمایشی:
  // svc در دسترس نبود → unavailable + ۰ (هرگز موجودیِ مثبتِ جعلی نمی‌سازیم).
  const wallet = await getWalletForUser(userId, 10);
  let balanceToman = 0;
  let unavailable = false;
  try {
    balanceToman = (await getUnifiedBalance(userId)).availableToman;
  } catch {
    unavailable = true;
  }
  return (
    <>
      <WalletPanel
        initialBalanceToman={balanceToman}
        plan={wallet.plan}
        unavailable={unavailable}
      />
      <LedgerList entries={wallet.ledger} />
    </>
  );
}

async function UsageSection({ userId }: { userId: string }) {
  const usage = await getUsageForUser(userId, 30);
  return <UsageTable rows={usage} />;
}

/* ─────────────────────── اسکلتِ کیف‌پول (هم‌شکلِ WalletPanel) ─────────────────────── */

/** اسکلتِ ستونِ کیف‌پول — کارتِ موجودی/لینکِ شارژ + کارتِ تراکنش‌ها، هم‌ابعادِ محتوای واقعی. */
function WalletSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* کارتِ موجودی + لینکِ شارژ در 1xai */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-40" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="mt-6 border-t border-border pt-5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-3 h-11 w-full rounded-full" />
        </div>
      </div>
      {/* کارتِ تراکنش‌ها */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <Skeleton className="h-5 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
