/**
 * صفحه‌ی «مدیریتِ کاربران» (Server component) — نمای همه‌ی کاربران برای ادمین.
 *
 * چرا این صفحه؟ تا امروز هیچ راهی در محصول نبود که ببینی چه کسی ثبت‌نام کرده، روی چه
 * پلنی است، یا چرا شکایت دارد — پشتیبانی یعنی SQLِ دستی. این صفحه همان کار را به یک
 * فهرستِ قابلِ جست‌وجو تبدیل می‌کند.
 *
 * تصمیم‌های کلیدی:
 *   • **بدونِ JS برای جست‌وجو/فیلتر**: فرمِ `method="get"` است، پس فیلترها در URL
 *     می‌نشینند (قابلِ اشتراک‌گذاری، قابلِ بوکمارک، بازگشتِ مرورگر درست کار می‌کند) و
 *     صفحه سرور-رندر می‌ماند.
 *   • **موجودیِ کیف‌پول در فهرست نیست**: خواندنش یک فراخوانیِ شبکه به 1xai است؛ در
 *     صفحه‌ی جزئیاتِ کاربر خوانده می‌شود، نه ۲۵ بار در هر صفحه‌ی فهرست.
 *   • دروازه‌بانی *در خودِ صفحه* است، نه فقط در ناوبری: اگر ادمین نباشی، محتوایی
 *     تولید نمی‌شود و صفحه ۴۰۴ می‌دهد (وجودِ بخشِ مدیریت را هم لو نمی‌دهد).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { isDashboardAdmin } from "@/components/dashboard/admin-guard";
import {
  ASSIGNABLE_PLANS,
  absoluteDateFa,
  displayName,
  planLabel,
  relativeTimeFa,
} from "@/components/dashboard/admin-labels";
import {
  getAdminUserStats,
  listAdminUsers,
  parseAdminUsersQuery,
  type AdminUsersQuery,
} from "@/components/dashboard/admin-users-data";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  IconChevronEnd,
  IconChevronStart,
  IconSearch,
  IconUserCheck,
  IconUsers,
  IconWallet,
} from "@/components/dashboard/icons";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  SkeletonStat,
  SkeletonTable,
  StatCard,
  TableFrame,
  cn,
  toFaDigits,
} from "@/components/dashboard/ui";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "کاربران",
  robots: { index: false, follow: false },
};

/** Next 16: `searchParams` یک Promise است و باید await شود. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getDashboardUser();
  if (!user) redirect("/login");
  // ادمین نیستی ⇒ این مسیر برای تو وجود ندارد.
  if (!(await isDashboardAdmin())) notFound();

  const query = parseAdminUsersQuery(await searchParams);

  return (
    <div className="space-y-8">
      <PageHeader
        title="کاربران"
        subtitle="هر حسابِ کارجو، وضعیتِ اشتراک و دسترسی‌اش — با جست‌وجو روی نام یا ایمیل."
      />

      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection />
      </Suspense>

      <FilterBar query={query} />

      <Suspense key={filterKey(query)} fallback={<SkeletonTable rows={8} cols={5} />}>
        <UsersSection query={query} />
      </Suspense>
    </div>
  );
}

/** کلیدِ Suspense — با هر تغییرِ فیلتر، اسکلتِ تازه نشان داده شود. */
function filterKey(q: AdminUsersQuery): string {
  return `${q.q}|${q.plan}|${q.status}|${q.page}|${q.pageSize}`;
}

/* ────────────────────────────────  آمار  ───────────────────────────────── */

async function StatsSection() {
  const stats = await getAdminUserStats();
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={<IconUsers />}
        value={stats.total}
        label="کلِ کاربران"
        tone="brand"
      />
      <StatCard
        icon={<IconUserCheck />}
        value={stats.newLast30d}
        label="ثبت‌نامِ ۳۰ روز اخیر"
        tone="accent"
      />
      <StatCard
        icon={<IconWallet />}
        value={stats.paying}
        label="اشتراکِ پولی"
        tone="green"
      />
      <StatCard
        icon={<IconUsers />}
        value={stats.suspended}
        label="دسترسیِ بسته"
        tone={stats.suspended > 0 ? "amber" : "muted"}
      />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
      <SkeletonStat />
      <SkeletonStat />
      <SkeletonStat />
      <SkeletonStat />
    </div>
  );
}

/* ──────────────────────────────  فیلترها  ──────────────────────────────── */

/**
 * نوارِ فیلتر — یک فرمِ GETِ ساده. هیچ state‌ای در کلاینت نیست؛ منبعِ حقیقت خودِ URL
 * است. `key` روی ورودی‌ها گذاشته شده تا با تغییرِ URL مقدارِ نمایشی هم به‌روز شود.
 */
function FilterBar({ query }: { query: AdminUsersQuery }) {
  const inputClass =
    "focus-ring w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/70";

  return (
    <form
      method="get"
      className="grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
    >
      <div className="relative">
        <label htmlFor="admin-user-search" className="sr-only">
          جست‌وجوی کاربر
        </label>
        <IconSearch className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-muted" />
        <input
          id="admin-user-search"
          type="search"
          name="q"
          defaultValue={query.q}
          placeholder="نام یا ایمیل…"
          className={cn(inputClass, "pe-10")}
        />
      </div>

      <div>
        <label htmlFor="admin-user-plan" className="sr-only">
          فیلترِ اشتراک
        </label>
        <select
          id="admin-user-plan"
          name="plan"
          defaultValue={query.plan}
          className={inputClass}
        >
          <option value="">همه‌ی اشتراک‌ها</option>
          {ASSIGNABLE_PLANS.map((plan) => (
            <option key={plan} value={plan}>
              {planLabel(plan)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="admin-user-status" className="sr-only">
          فیلترِ دسترسی
        </label>
        <select
          id="admin-user-status"
          name="status"
          defaultValue={query.status}
          className={inputClass}
        >
          <option value="">هر وضعیتی</option>
          <option value="active">دسترسیِ باز</option>
          <option value="suspended">دسترسیِ بسته</option>
        </select>
      </div>

      <button
        type="submit"
        className="focus-ring rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition-[filter] hover:brightness-110"
      >
        اعمالِ فیلتر
      </button>
    </form>
  );
}

/* ──────────────────────────────  جدول  ─────────────────────────────────── */

async function UsersSection({ query }: { query: AdminUsersQuery }) {
  const { rows, total, page, pageCount } = await listAdminUsers(query);

  if (rows.length === 0) {
    const filtered = Boolean(query.q || query.plan || query.status);
    return (
      <EmptyState
        icon={<IconUsers />}
        title={filtered ? "کاربری با این فیلتر پیدا نشد" : "هنوز کاربری ثبت‌نام نکرده"}
        body={
          filtered
            ? "عبارتِ جست‌وجو یا فیلترها را تغییر بده."
            : "به‌محضِ اولین ثبت‌نام، کاربران این‌جا دیده می‌شوند."
        }
        action={
          filtered ? (
            <ButtonLink href="/dashboard/admin/users" variant="secondary" size="sm">
              پاک‌کردنِ فیلترها
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {toFaDigits(total)} کاربر — صفحه‌ی {toFaDigits(page)} از {toFaDigits(pageCount)}
      </p>

      <TableFrame minWidth="46rem">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/60 text-start text-xs text-muted">
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                کاربر
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                اشتراک
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                دسترسی
              </th>
              <th scope="col" className="px-4 py-3 text-start font-semibold">
                اپلای‌ها
              </th>
              <th scope="col" className="hidden px-4 py-3 text-start font-semibold lg:table-cell">
                آخرین فعالیت
              </th>
              <th scope="col" className="hidden px-4 py-3 text-start font-semibold xl:table-cell">
                ثبت‌نام
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-foreground/[0.03]">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/admin/users/${row.id}`}
                    className="focus-ring block rounded-lg"
                  >
                    <span className="block font-semibold text-foreground">
                      {displayName(row)}
                    </span>
                    <span className="ltr-nums block text-xs text-muted">
                      {row.email ?? "بدونِ ایمیل"}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={row.plan === "free" ? "muted" : "brand"}>
                    {planLabel(row.plan)}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={row.isActive ? "green" : "rose"}>
                    {row.isActive ? "باز" : "بسته"}
                  </Badge>
                </td>
                <td className="ltr-nums px-4 py-3">{toFaDigits(row.applicationCount)}</td>
                <td
                  className="hidden px-4 py-3 text-muted lg:table-cell"
                  title={absoluteDateFa(row.lastSeenAt)}
                >
                  {relativeTimeFa(row.lastSeenAt)}
                </td>
                <td
                  className="hidden px-4 py-3 text-muted xl:table-cell"
                  title={absoluteDateFa(row.createdAt)}
                >
                  {relativeTimeFa(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

      <Pagination query={query} page={page} pageCount={pageCount} />
    </div>
  );
}

/* ────────────────────────────  صفحه‌بندی  ──────────────────────────────── */

/** لینک‌های «قبلی/بعدی» — فیلترهای فعلی را حفظ می‌کنند. */
function Pagination({
  query,
  page,
  pageCount,
}: {
  query: AdminUsersQuery;
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.plan) params.set("plan", query.plan);
    if (query.status) params.set("status", query.status);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/dashboard/admin/users?${qs}` : "/dashboard/admin/users";
  };

  const linkClass =
    "focus-ring inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground";

  return (
    <nav className="flex items-center justify-between gap-3" aria-label="صفحه‌بندی">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass} rel="prev">
          <IconChevronStart className="h-4 w-4" />
          صفحه‌ی قبل
        </Link>
      ) : (
        <span />
      )}
      {page < pageCount ? (
        <Link href={href(page + 1)} className={linkClass} rel="next">
          صفحه‌ی بعد
          <IconChevronEnd className="h-4 w-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
