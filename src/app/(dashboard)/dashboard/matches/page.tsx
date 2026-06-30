/**
 * نمای «تطبیق‌ها» (server component) — فهرستِ کاملِ تطبیق‌های AI کاربر.
 *
 * gate شده با نشست. هر کارت: امتیاز، شرکت/عنوان، پیش‌نمایشِ انگیزه‌نامه و دلیلِ AI.
 * پنلِ «اتصالِ افزونه» و وضعیتِ حساب‌های متصل هم اینجاست. خواندنِ DB در Suspense.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
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
import { MatchCard } from "@/components/dashboard/match-card";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  Card,
  EmptyState,
  SectionHeading,
  Skeleton,
  toFaDigits,
} from "@/components/dashboard/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "تطبیق‌ها",
  robots: { index: false, follow: false },
};

export default async function MatchesPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="matches">
      <SectionHeading
        title="تطبیق‌های شما"
        subtitle="فرصت‌هایی که هوش مصنوعی کارجو با پروفایل شما تطبیق داده — مرتب بر اساس امتیاز."
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<ListSkeleton />}>
            <MatchesList userId={user.userId} />
          </Suspense>
        </div>

        <div className="space-y-6">
          <Suspense fallback={<Skeleton className="h-64" />}>
            <CostPanel userId={user.userId} />
          </Suspense>
          <PairExtensionPanel />
          <Suspense fallback={<Skeleton className="h-40" />}>
            <ConnectedBoards userId={user.userId} />
          </Suspense>
        </div>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخش‌های async (Suspense) ───────────────────────── */

async function MatchesList({ userId }: { userId: string }) {
  const matches = await getMatchesForUser(userId, 50);

  if (matches.length === 0) {
    return (
      <EmptyState
        icon="🧭"
        title="هنوز تطبیقی ثبت نشده"
        body="کارجو به‌صورت خودکار آگهی‌های تازه را با پروفایل شما می‌سنجد. به‌محض پیدا‌شدنِ فرصتِ مناسب، اینجا فهرست می‌شود."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <span className="ltr-nums font-medium text-foreground">{toFaDigits(matches.length)}</span> تطبیق
      </p>
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} />
      ))}
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
    <Card className="p-6">
      <h3 className="text-base font-bold">حساب‌های متصل</h3>
      <p className="mt-1 text-sm text-muted">
        سایت‌هایی که حساب‌تان به آن‌ها متصل است (فقط وضعیت — هیچ رمز/نشستی روی سرور
        نگه‌داری نمی‌شود).
      </p>

      {accounts.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-card/50 px-4 py-5 text-center text-sm text-muted">
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
                className="flex items-center justify-between gap-2 rounded-xl border border-border px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{boardLabel(acc.board)}</div>
                  {acc.accountLabel ? (
                    <div className="truncate text-xs text-muted">{acc.accountLabel}</div>
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

function ListSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}
