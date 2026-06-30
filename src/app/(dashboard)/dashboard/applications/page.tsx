/**
 * نمای «اپلای‌ها» (server component) — پیگیریِ تلاش‌های اپلای کاربر.
 *
 * gate شده با نشست. در فازِ فعلی معمولاً خالی است (هنوز اپلای انجام نشده)، پس حالتِ
 * خالیِ روشن نمایش می‌دهد. وقتی اپلای‌ها ثبت شوند، به‌صورت جدول/فهرست با وضعیت و
 * کانال نمایش داده می‌شوند. خواندنِ DB در Suspense.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getApplicationsForUser } from "@/components/dashboard/data";
import {
  APPLICATION_STATUS,
  boardLabel,
  CHANNEL_LABELS,
} from "@/components/dashboard/labels";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  Card,
  EmptyState,
  SectionHeading,
  Skeleton,
} from "@/components/dashboard/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "اپلای‌ها",
  robots: { index: false, follow: false },
};

/** قالبِ تاریخِ کوتاهِ فارسی (تقویمِ شمسی نمایش). */
function faDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
}

export default async function ApplicationsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <DashboardShell active="applications">
      <SectionHeading
        title="پیگیری اپلای‌ها"
        subtitle="وضعیتِ هر اپلایی که با تأییدِ شما ثبت می‌شود را اینجا دنبال کنید."
      />

      <div className="mt-8">
        <Suspense fallback={<TableSkeleton />}>
          <ApplicationsList userId={user.userId} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/* ───────────────────────── بخش async (Suspense) ───────────────────────── */

async function ApplicationsList({ userId }: { userId: string }) {
  const apps = await getApplicationsForUser(userId, 100);

  if (apps.length === 0) {
    return (
      <EmptyState
        icon="📨"
        title="هنوز اپلایی ثبت نشده"
        body="وقتی یک تطبیق را برای اپلای تأیید کنید، نتیجه و وضعیتِ آن (ارسال‌شده، در انتظار، …) همین‌جا نمایش داده می‌شود."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      {/* جدولِ دسکتاپ */}
      <div className="hidden md:block">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-border bg-foreground/[0.02] text-xs text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">موقعیت شغلی</th>
              <th className="px-5 py-3 font-medium">سایت</th>
              <th className="px-5 py-3 font-medium">کانال</th>
              <th className="px-5 py-3 font-medium">تاریخ</th>
              <th className="px-5 py-3 font-medium">وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app) => {
              const status =
                APPLICATION_STATUS[app.status] ?? APPLICATION_STATUS.draft;
              return (
                <tr key={app.id} className="border-b border-border/60 last:border-0">
                  <td className="px-5 py-3.5">
                    <a
                      href={app.listing.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="font-medium transition-colors hover:text-brand"
                    >
                      {app.listing.title}
                    </a>
                    <div className="text-xs text-muted">
                      {app.listing.company ?? "—"}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted">{boardLabel(app.listing.board)}</td>
                  <td className="px-5 py-3.5 text-muted">
                    {app.channel ? CHANNEL_LABELS[app.channel] ?? app.channel : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-muted">
                    {faDate(app.submittedAt ?? app.createdAt)}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* کارت‌های موبایل */}
      <ul className="divide-y divide-border md:hidden">
        {apps.map((app) => {
          const status = APPLICATION_STATUS[app.status] ?? APPLICATION_STATUS.draft;
          return (
            <li key={app.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <a
                    href={app.listing.url}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="truncate font-medium transition-colors hover:text-brand"
                  >
                    {app.listing.title}
                  </a>
                  <div className="text-xs text-muted">
                    {boardLabel(app.listing.board)}
                    {app.listing.company ? ` · ${app.listing.company}` : ""}
                  </div>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <div className="mt-2 text-xs text-muted">
                {faDate(app.submittedAt ?? app.createdAt)}
                {app.channel ? ` · ${CHANNEL_LABELS[app.channel] ?? app.channel}` : ""}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-5 w-40" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </Card>
  );
}
