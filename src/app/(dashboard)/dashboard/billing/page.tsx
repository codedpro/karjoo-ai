/**
 * «اعتبار و هزینه» (Server component) — پول: چقدر مانده، کجا خرج شده، چطور شارژ می‌شود.
 *
 * مرزِ این صفحه با «اشتراک» عمداً در یک جمله گفته می‌شود: این‌جا *پول* است (موجودی و ریزِ
 * مصرف)، آن‌جا *پلن* (سهمیه و امکانات). قبلاً هر دو صفحه یک پاراگرافِ چهارخطیِ تقریباً یکسان
 * داشتند و کاربر نمی‌فهمید کدام را باز کند.
 *
 * موجودی از کیف‌پولِ *واحدِ 1xAi* خوانده می‌شود. این صفحه *نمایشی* است: اگر svcِ 1xai در
 * دسترس نباشد، به‌جای موجودیِ جعلی حالتِ «موقتاً در دسترس نیست» به پنل پاس می‌شود.
 *
 * ترتیبِ روایت عمدی است: چقدر داری (کیف‌پول) → هر کار چقدر می‌ارزد (`AiCostPanel`، که خانه‌ی
 * درستش همین‌جاست نه کنارِ فهرستِ فرصت‌ها) → واقعاً چه خرج شده (ریزِ مصرف).
 *
 * الگو: پوسته در `dashboard/layout.tsx` استاتیک است؛ هر بخشِ وابسته به DB داخلِ `<Suspense>`
 * با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود. داده مقید به userIdِ نشست (قاعده‌ی ۴).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getUsageForUser, getWalletForUser } from "@/components/dashboard/wallet-data";
import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import { getUnifiedBalance } from "@/lib/billing/unified";
import { AiCostPanel } from "@/components/dashboard/ai-cost-panel";
import { LedgerList, UsageTable } from "@/components/dashboard/wallet-history";
import { WalletPanel } from "@/components/dashboard/wallet-panel";
import { IconPlan } from "@/components/dashboard/icons";
import {
  ButtonLink,
  Callout,
  Card,
  PageHeader,
  SectionHeading,
  Skeleton,
  SkeletonTable,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (دیگر force-dynamic لازم نیست).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اعتبار و هزینه",
  robots: { index: false, follow: false },
};

export default async function BillingPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const { userId } = user;

  return (
    <div className="space-y-6">
      <PageHeader
        title="اعتبار و هزینه"
        subtitle="موجودیِ کیف‌پولت و اینکه هر تومان کجا خرج شده است."
      />

      <Callout
        icon={<IconPlan />}
        title="این‌جا پول است؛ اشتراک جای دیگری است"
        action={
          <ButtonLink href="/dashboard/plans" variant="secondary" size="sm">
            اشتراک
          </ButtonLink>
        }
      >
        سهمیه‌ی اپلای و امکاناتِ حساب به پلنِ اشتراکت بستگی دارد، نه به موجودی.
      </Callout>

      <div className="grid gap-6 lg:grid-cols-3 2xl:grid-cols-4">
        {/* ستونِ کیف‌پول + تراکنش‌ها */}
        <div className="space-y-6 lg:col-span-1">
          <Suspense fallback={<WalletSkeleton />}>
            <WalletSection userId={userId} />
          </Suspense>
        </div>

        {/* ستونِ «نرخِ هر کار» + تاریخچه‌ی مصرف — اول قیمت، بعد آن‌چه واقعاً خرج شده. */}
        <div className="space-y-6 lg:col-span-2 2xl:col-span-3">
          <Suspense fallback={<CostSkeleton />}>
            <CostSection userId={userId} />
          </Suspense>

          <section>
            <SectionHeading
              as="h2"
              title="ریزِ مصرفِ هوش مصنوعی"
              subtitle="هزینه‌ی هر پردازش، به‌اندازه‌ی مصرفِ واقعی، از همین کیف‌پول کسر شده است."
            />
            <div className="mt-5">
              <Suspense fallback={<SkeletonTable rows={6} cols={4} />}>
                <UsageSection userId={userId} />
              </Suspense>
            </div>
          </section>
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

async function CostSection({ userId }: { userId: string }) {
  const ctx = await getUserAiCostContext(userId);
  return (
    <AiCostPanel
      plan={ctx.plan}
      canUsePaidAi={ctx.canUsePaidAi}
      matchEstimate={actionEstimate(ctx, "match")}
      coverLetterEstimate={actionEstimate(ctx, "cover_letter")}
    />
  );
}

async function UsageSection({ userId }: { userId: string }) {
  const usage = await getUsageForUser(userId, 30);
  return <UsageTable rows={usage} />;
}

/** هم‌شکلِ AiCostPanel — عنوان + نشانِ پلن + دو ردیفِ نرخ. */
function CostSkeleton() {
  return (
    <Card padded aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <Skeleton className="mt-4 h-3 w-2/3" />
    </Card>
  );
}

/* ─────────────────────── اسکلتِ کیف‌پول (هم‌شکلِ WalletPanel) ─────────────────────── */

/** اسکلتِ ستونِ کیف‌پول — کارتِ موجودی/شارژ + کارتِ تراکنش‌ها، هم‌ابعادِ محتوای واقعی. */
function WalletSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* کارتِ موجودی + مسیرِ شارژ */}
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
          <Skeleton className="mt-3 h-3 w-3/4" />
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
