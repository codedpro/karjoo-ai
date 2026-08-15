/**
 * صفحه‌ی «یک کاربر» در بخشِ مدیریت (Server component) — نمای کامل + اهرم‌های ادمین.
 *
 * این صفحه به سه سؤالِ پشتیبانی جواب می‌دهد:
 *   ۱) این کاربر کیست و روی چه اشتراکی است؟
 *   ۲) سرویس برایش چه کار کرده (اپلای‌ها، بردهای متصل، رزومه‌ها)؟
 *   ۳) چه کاری می‌توانم برایش بکنم (اشتراک، اعتبار، دسترسی)؟
 *
 * مرزها:
 *   • دروازه‌بانی در خودِ صفحه است؛ غیرِ ادمین ۴۰۴ می‌گیرد (وجودِ بخش لو نمی‌رود).
 *   • هیچ مادهٔ حساسی رندر نمی‌شود: نه کلیدِ API، نه توکنِ نشست، نه نشستِ بردها —
 *     فقط *وجود*شان به‌صورتِ عدد/برچسب.
 *   • خودِ صفحه چیزی تغییر نمی‌دهد؛ هر تغییر از server actionهای admin-users-actions
 *     می‌گذرد که مستقلاً ادمین‌بودن را دوباره چک می‌کنند.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { isDashboardAdmin } from "@/components/dashboard/admin-guard";
import {
  absoluteDateFa,
  applicationStatusLabel,
  displayName,
  paymentKindLabel,
  paymentStatusLabel,
  planLabel,
  relativeTimeFa,
  tomanFa,
} from "@/components/dashboard/admin-labels";
import {
  AccessControl,
  CreditControl,
  PlanControl,
} from "@/components/dashboard/admin-user-controls";
import { getAdminUserDetail } from "@/components/dashboard/admin-users-data";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  IconChevronStart,
  IconDoc,
  IconPlug,
  IconSend,
  IconTarget,
} from "@/components/dashboard/icons";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonTable,
  StatCard,
  TableFrame,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "کاربر",
  robots: { index: false, follow: false },
};

/** Next 16: `params` یک Promise است و باید await شود. */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getDashboardUser();
  if (!viewer) redirect("/login");
  if (!(await isDashboardAdmin())) notFound();

  const { id } = await params;

  return (
    <div className="space-y-8">
      <Link
        href="/dashboard/admin/users"
        className="focus-ring inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <IconChevronStart className="h-4 w-4" />
        بازگشت به فهرستِ کاربران
      </Link>

      <Suspense fallback={<DetailSkeleton />}>
        <DetailSection userId={id} />
      </Suspense>
    </div>
  );
}

/* ────────────────────────────────  محتوا  ──────────────────────────────── */

async function DetailSection({ userId }: { userId: string }) {
  const detail = await getAdminUserDetail(userId);
  if (!detail) notFound();

  const { user } = detail;

  return (
    <div className="space-y-8">
      <PageHeader
        title={displayName(user)}
        subtitle={user.email ?? "این حساب ایمیلِ ثبت‌شده ندارد."}
        actions={
          <>
            <Badge tone={user.plan === "free" ? "muted" : "brand"}>
              {planLabel(user.plan)}
            </Badge>
            <Badge tone={user.isActive ? "green" : "rose"}>
              {user.isActive ? "دسترسیِ باز" : "دسترسیِ بسته"}
            </Badge>
          </>
        }
      />

      {/* خلاصه‌ی وضعیت */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<IconSend />}
          value={user.applicationCount}
          label="کلِ اپلای‌ها"
          tone="brand"
        />
        <StatCard
          icon={<IconTarget />}
          value={detail.matchCount}
          label="فرصت‌های پیشنهادشده"
          tone="accent"
        />
        <StatCard
          icon={<IconDoc />}
          value={detail.resumeCount}
          label="رزومه‌های ذخیره‌شده"
          tone="muted"
        />
        <StatCard
          icon={<IconPlug />}
          value={detail.activeSessions}
          label="نشست‌های فعال"
          tone={detail.activeSessions > 0 ? "green" : "muted"}
        />
      </div>

      {/* حقایقِ حساب + اهرم‌های ادمین، کنارِ هم روی نمایشگرِ پهن */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card padded className="space-y-3 xl:col-span-1">
          <h3 className="text-base font-bold">اطلاعاتِ حساب</h3>
          <dl className="space-y-2.5 text-sm">
            <Fact label="ثبت‌نام" value={absoluteDateFa(user.createdAt)} />
            <Fact
              label="آخرین فعالیت"
              value={relativeTimeFa(user.lastSeenAt)}
              title={absoluteDateFa(user.lastSeenAt)}
            />
            <Fact
              label="پایانِ اشتراک"
              value={user.planExpiresAt ? absoluteDateFa(user.planExpiresAt) : "بدونِ انقضا"}
            />
            <Fact label="اعتبارِ کیف پول" value={tomanFa(detail.balanceToman)} />
            <Fact
              label="اپلای خودکارِ سرور"
              value={detail.serverAutoApply ? "روشن" : "خاموش"}
            />
            <Fact
              label="بردهای متصل"
              value={
                detail.boards.length === 0
                  ? "هیچ"
                  : detail.boards.map((b) => `${b.board} (${b.status})`).join("، ")
              }
            />
          </dl>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2 xl:col-span-2 xl:grid-cols-1 2xl:grid-cols-2">
          <PlanControl userId={user.id} currentPlan={user.plan} />
          <CreditControl userId={user.id} balanceToman={detail.balanceToman} />
          <AccessControl userId={user.id} isActive={user.isActive} />
        </div>
      </div>

      {/* فعالیتِ اخیر */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold">۲۰ اپلایِ اخیر</h2>
        {detail.recentApplications.length === 0 ? (
          <EmptyState
            icon={<IconSend />}
            title="هنوز اپلایی ثبت نشده"
            body="به‌محضِ اولین اپلای، سابقه‌اش این‌جا دیده می‌شود."
          />
        ) : (
          <TableFrame minWidth="36rem">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-xs text-muted">
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    وضعیت
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    مسیر
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    امتیازِ تطبیق
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    ثبت
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-semibold lg:table-cell">
                    ارسال
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.recentApplications.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Badge tone={row.status === "submitted" ? "green" : "muted"}>
                        {applicationStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{row.channel ?? "—"}</td>
                    <td className="ltr-nums px-4 py-3">
                      {row.matchScore === null
                        ? "—"
                        : `${toFaDigits(Math.round(row.matchScore * 100))}٪`}
                    </td>
                    <td
                      className="px-4 py-3 text-muted"
                      title={absoluteDateFa(row.createdAt)}
                    >
                      {relativeTimeFa(row.createdAt)}
                    </td>
                    <td
                      className="hidden px-4 py-3 text-muted lg:table-cell"
                      title={absoluteDateFa(row.submittedAt)}
                    >
                      {row.submittedAt ? relativeTimeFa(row.submittedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </section>

      {/* درخواست‌های پرداخت */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold">درخواست‌های پرداخت</h2>
        {detail.payments.length === 0 ? (
          <p className="text-sm text-muted">این کاربر درخواستِ پرداختی ثبت نکرده است.</p>
        ) : (
          <TableFrame minWidth="32rem">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-xs text-muted">
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    نوع
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    مبلغ
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    وضعیت
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    زمان
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-semibold lg:table-cell">
                    بررسی‌کننده
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.payments.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      {paymentKindLabel(row.kind)}
                      {row.targetPlan ? ` — ${planLabel(row.targetPlan)}` : ""}
                    </td>
                    <td className="ltr-nums px-4 py-3">{tomanFa(row.amountToman)}</td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          row.status === "approved"
                            ? "green"
                            : row.status === "rejected"
                              ? "rose"
                              : "amber"
                        }
                      >
                        {paymentStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td
                      className="px-4 py-3 text-muted"
                      title={absoluteDateFa(row.createdAt)}
                    >
                      {relativeTimeFa(row.createdAt)}
                    </td>
                    <td className="ltr-nums hidden px-4 py-3 text-muted lg:table-cell">
                      {row.reviewedBy ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </section>
    </div>
  );
}

/** یک سطرِ «برچسب / مقدار» در کارتِ اطلاعاتِ حساب. */
function Fact({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-pretty font-medium" title={title}>
        {value}
      </dd>
    </div>
  );
}

/* ────────────────────────────────  اسکلت  ──────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl xl:col-span-2" />
      </div>
      <SkeletonTable rows={5} cols={5} />
    </div>
  );
}
