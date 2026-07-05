/**
 * نمای «تطبیق‌ها» (Server component) — فهرستِ کاملِ تطبیق‌های AI کاربر.
 *
 * الگوی Next 16: پوسته/هدر در `dashboard/layout.tsx` فوری است؛ این صفحه فقط محتوا
 * می‌دهد و هدرِ استاتیکِ خودش (`PageHeader`) بی‌درنگ رندر می‌شود. حضورِ نشست پیش‌تر در
 * `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط `userId` می‌گیریم. هر خواندنِ DB داخلِ
 * `<Suspense>` با اسکلتِ **هم‌شکلِ محتوا** استریم می‌شود — نه بلاکِ خاکستریِ کلی.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AiCostPanel } from "@/components/dashboard/ai-cost-panel";
import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import {
  getBoardAccountsForUser,
  getMatchesForUser,
} from "@/components/dashboard/data";
import { BOARD_ACCOUNT_STATUS, boardLabel } from "@/components/dashboard/labels";
import { IconCompass } from "@/components/dashboard/icons";
import { MatchCard } from "@/components/dashboard/match-card";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonList,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "تطبیق‌ها",
  robots: { index: false, follow: false },
};

export default async function MatchesPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const userId = user.userId;

  return (
    <div className="space-y-8">
      <PageHeader
        title="تطبیق‌های شما"
        subtitle="فرصت‌هایی که هوش مصنوعی کارجو با پروفایلت تطبیق داده — مرتب بر اساسِ امتیاز."
        actions={
          <ButtonLink href="/dashboard/applications" variant="secondary" size="sm">
            پیگیری اپلای‌ها
          </ButtonLink>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ستونِ اصلی: فهرستِ تطبیق‌ها */}
        <div className="lg:col-span-2">
          <Suspense fallback={<MatchesSkeleton />}>
            <MatchesList userId={userId} />
          </Suspense>
        </div>

        {/* ستونِ کناری: هزینه، افزونه، حساب‌های متصل */}
        <aside className="space-y-6">
          <Suspense fallback={<CostSkeleton />}>
            <CostPanel userId={userId} />
          </Suspense>
          <PairExtensionPanel />
          <Suspense fallback={<BoardsSkeleton />}>
            <ConnectedBoards userId={userId} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function MatchesList({ userId }: { userId: string }) {
  const matches = await getMatchesForUser(userId, 50);

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={<IconCompass />}
        title="هنوز تطبیقی ثبت نشده"
        body="کارجو به‌صورتِ خودکار آگهی‌های تازه را با پروفایلت می‌سنجد. به‌محضِ پیدا‌شدنِ فرصتِ مناسب، این‌جا فهرست می‌شود."
        action={
          <ButtonLink href="/dashboard/resume" variant="secondary" size="sm">
            تکمیلِ پروفایل و رزومه
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Badge tone="brand">
          <span className="ltr-nums tabular-nums">{toFaDigits(matches.length)}</span>
          &nbsp;تطبیق
        </Badge>
        <span className="text-pretty">به‌ترتیبِ بالاترین امتیاز</span>
      </div>
      <ol className="space-y-4">
        {matches.map((m) => (
          <li key={m.id}>
            <MatchCard match={m} />
          </li>
        ))}
      </ol>
    </div>
  );
}

async function CostPanel({ userId }: { userId: string }) {
  const ctx = await getUserAiCostContext(userId);
  return (
    <AiCostPanel
      plan={ctx.plan}
      balanceToman={ctx.balanceToman}
      canUsePaidAi={ctx.canUsePaidAi}
      matchEstimate={actionEstimate(ctx, "match")}
      coverLetterEstimate={actionEstimate(ctx, "cover_letter")}
    />
  );
}

async function ConnectedBoards({ userId }: { userId: string }) {
  const accounts = await getBoardAccountsForUser(userId);

  return (
    <Card padded>
      <h3 className="text-balance text-base font-bold">حساب‌های متصل</h3>
      <p className="mt-1 text-pretty text-sm leading-6 text-muted">
        سایت‌هایی که حسابت به آن‌ها متصل است. اتصال فقط با اجازه‌ی خودت و برای اپلای
        به‌جای توست؛ هر زمان می‌توانی آن را قطع کنی.
      </p>

      {accounts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-sm text-muted">
          هنوز حسابی متصل نشده است.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {accounts.map((acc) => {
            const status =
              BOARD_ACCOUNT_STATUS[acc.status] ?? BOARD_ACCOUNT_STATUS.needs_reauth;
            return (
              <li
                key={acc.board}
                className="flex items-center justify-between gap-2.5 rounded-xl border border-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {boardLabel(acc.board)}
                  </div>
                  {acc.accountLabel ? (
                    <div className="truncate text-xs text-muted" title={acc.accountLabel}>
                      {acc.accountLabel}
                    </div>
                  ) : null}
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ─────────────────────── اسکلت‌های هم‌شکلِ محتوا ─────────────────────── */

/** هم‌شکلِ فهرستِ تطبیق‌ها: چیپِ شمارش + چند کارت. */
function MatchesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-6 w-28 rounded-full" />
      <SkeletonList rows={4} />
    </div>
  );
}

/** هم‌شکلِ AiCostPanel: عنوان + نشانِ پلن + کارتِ موجودی + دو ردیفِ هزینه. */
function CostSkeleton() {
  return (
    <Card padded aria-hidden>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 rounded-xl border border-border bg-surface/70 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-5 w-28" />
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </Card>
  );
}

/** هم‌شکلِ «حساب‌های متصل»: عنوان + دو ردیفِ حساب. */
function BoardsSkeleton() {
  return (
    <Card padded aria-hidden>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-2 h-3 w-full" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-xl border border-border px-3.5 py-2.5"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}
