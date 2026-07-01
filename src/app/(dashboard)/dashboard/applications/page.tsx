/**
 * نمای «اپلای‌ها» (Server component) — پیگیریِ تلاش‌های اپلای کاربر.
 *
 * الگوی Next 16: پوسته/هدر در `dashboard/layout.tsx` فوری است؛ این صفحه فقط محتوا
 * می‌دهد و هدرِ استاتیکِ خودش بی‌درنگ رندر می‌شود. حضورِ نشست پیش‌تر در `proxy.ts`
 * چک شده؛ این‌جا فقط `userId` می‌گیریم. در فازِ فعلی معمولاً خالی است، پس حالتِ خالیِ
 * روشن نشان می‌دهد. خواندنِ DB داخلِ `<Suspense>` با اسکلتِ **هم‌شکلِ جدول** استریم می‌شود.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getApplicationsForUser } from "@/components/dashboard/data";
import { IconSend } from "@/components/dashboard/icons";
import {
  APPLICATION_STATUS,
  boardLabel,
  CHANNEL_LABELS,
} from "@/components/dashboard/labels";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SkeletonTable,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

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

/** برچسبِ کانالِ اجرا (افزونه/نودِ ایرانی) با tone یکدست. */
function channelLabel(channel: string | null): string {
  if (!channel) return "—";
  return CHANNEL_LABELS[channel] ?? channel;
}

export default async function ApplicationsPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="پیگیری اپلای‌ها"
        subtitle="وضعیتِ هر اپلایی که با تأییدِ تو ثبت می‌شود را این‌جا دنبال کن."
        actions={
          <ButtonLink href="/dashboard/matches" variant="secondary" size="sm">
            دیدنِ تطبیق‌ها
          </ButtonLink>
        }
      />

      <Suspense fallback={<SkeletonTable rows={5} cols={5} />}>
        <ApplicationsList userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخش async (Suspense) ───────────────────────── */

async function ApplicationsList({ userId }: { userId: string }) {
  const apps = await getApplicationsForUser(userId, 100);

  if (apps.length === 0) {
    return (
      <EmptyState
        icon={<IconSend />}
        title="هنوز اپلایی ثبت نشده"
        body="وقتی یک تطبیق را برای اپلای تأیید کنی، نتیجه و وضعیتِ آن (ارسال‌شده، در انتظار، …) همین‌جا نمایش داده می‌شود."
        action={
          <ButtonLink href="/dashboard/matches" size="sm">
            رفتن به تطبیق‌ها
          </ButtonLink>
        }
      />
    );
  }

  const submitted = apps.filter((a) => a.status === "submitted").length;

  return (
    <div className="space-y-4">
      {/* خلاصه‌ی شمارش — چیپ‌های موجز، بدونِ شکستنِ خط */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="muted">
          <span className="ltr-nums tabular-nums">{toFaDigits(apps.length)}</span>
          &nbsp;اپلای
        </Badge>
        {submitted > 0 ? (
          <Badge tone="green">
            <span className="ltr-nums tabular-nums">{toFaDigits(submitted)}</span>
            &nbsp;ارسال‌شده
          </Badge>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {/* جدولِ دسکتاپ */}
        <div className="hidden md:block">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-xs font-medium text-muted">
                <th scope="col" className="px-5 py-3.5 text-start">موقعیتِ شغلی</th>
                <th scope="col" className="px-5 py-3.5 text-start">سایت</th>
                <th scope="col" className="px-5 py-3.5 text-start">کانال</th>
                <th scope="col" className="px-5 py-3.5 text-start whitespace-nowrap">تاریخ</th>
                <th scope="col" className="px-5 py-3.5 text-start">وضعیت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {apps.map((app) => {
                const status =
                  APPLICATION_STATUS[app.status] ?? APPLICATION_STATUS.draft;
                return (
                  <tr key={app.id} className="transition-colors hover:bg-foreground/[1.5%]">
                    <td className="max-w-[22rem] px-5 py-3.5">
                      <a
                        href={app.listing.url}
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                        className="focus-ring block truncate rounded-sm font-medium transition-colors hover:text-brand"
                        title={app.listing.title}
                      >
                        {app.listing.title}
                      </a>
                      <div className="truncate text-xs text-muted" title={app.listing.company ?? undefined}>
                        {app.listing.company ?? "—"}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {boardLabel(app.listing.board)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {channelLabel(app.channel)}
                    </td>
                    <td className="ltr-nums px-5 py-3.5 whitespace-nowrap tabular-nums text-muted">
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

        {/* کارت‌های موبایل — هر ردیف یک کارتِ فشرده و خوانا */}
        <ul className="divide-y divide-border md:hidden">
          {apps.map((app) => {
            const status = APPLICATION_STATUS[app.status] ?? APPLICATION_STATUS.draft;
            return (
              <li key={app.id} className="p-4">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <a
                      href={app.listing.url}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="focus-ring block truncate rounded-sm font-medium transition-colors hover:text-brand"
                      title={app.listing.title}
                    >
                      {app.listing.title}
                    </a>
                    <div className="truncate text-xs text-muted">
                      {boardLabel(app.listing.board)}
                      {app.listing.company ? ` · ${app.listing.company}` : ""}
                    </div>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <div className="ltr-nums mt-2 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted">
                  <span>{faDate(app.submittedAt ?? app.createdAt)}</span>
                  {app.channel ? <span>· {channelLabel(app.channel)}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
