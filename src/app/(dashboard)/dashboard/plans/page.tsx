/**
 * «اشتراک» (Server component) — اشتراکِ واحدِ 1xAi و کارجو.
 *
 * کارجو پلنِ جداگانه ندارد: همان اشتراکی که کاربر در 1xai.ir می‌خرد، مزایای کارجو را هم
 * می‌دهد (اپلای نامحدود، ورکرِ سرور). این صفحه اشتراکِ فعلی و مزایایش را نشان می‌دهد و
 * جدولِ پلن‌ها را مستقیم از 1xai می‌خواند تا هیچ عددی این‌جا کپی و کهنه نشود. خرید و تغییر
 * فقط در 1xai انجام می‌شود.
 *
 * پوسته در `dashboard/layout.tsx` استاتیک است؛ داده مقید به userIdِ نشست.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { SectionTabs, ACCOUNT_TABS } from "@/components/dashboard/section-tabs";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  PageHeader,
  Skeleton,
  TableFrame,
  toFaDigits,
} from "@/components/dashboard/ui";
import { IconWallet } from "@/components/dashboard/icons";
import {
  FREE_APPLY_QUOTA_PER_DAY,
  ONEXAI_PLAN_URL,
  ONEXAI_PLANS_URL,
  ONEXAI_TOPUP_URL,
} from "@/lib/billing/entitlements";
import { onexaiSvcConfig } from "@/lib/env";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "اشتراک",
  robots: { index: false, follow: false },
};

function formatToman(n: number): string {
  return toFaDigits(Math.round(n).toLocaleString("en-US")).replace(/,/g, "٬");
}

function faDate(d: Date): string {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(d);
}

export default async function PlansPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <PageHeader
        title="اشتراک"
        subtitle="اشتراکِ کارجو و 1xAi یکی است: هر پلنی که در 1xAi داشته باشی، مزایای کارجو را هم می‌دهد."
        actions={
          <ButtonLink href={ONEXAI_PLAN_URL} size="sm">
            مدیریتِ اشتراک در 1xAi
          </ButtonLink>
        }
      />
      <SectionTabs tabs={ACCOUNT_TABS} active="/dashboard/plans" ariaLabel="زبانه‌های حساب" />

      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <CurrentSubscription userId={user.userId} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <PlansTable />
      </Suspense>
    </div>
  );
}

async function CurrentSubscription({ userId }: { userId: string }) {
  const { entitlements: e, balanceToman, apply } = await getUserPlanStatus(userId);

  return (
    <div className="space-y-4">
      {e.unavailable ? (
        <Callout tone="warn" title="اتصال به 1xAi برقرار نشد">
          اشتراک موقتاً خوانده نشد؛ تا برقراریِ دوباره، محدودیت‌های پلنِ رایگان اعمال می‌شود.
        </Callout>
      ) : null}
      <Card padded>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="اشتراکِ فعلی">
            <span className="flex items-center gap-2">
              {e.planNameFa}
              <Badge tone={e.status === "active" ? "green" : "muted"}>
                {e.status === "active" ? "فعال" : "رایگان"}
              </Badge>
            </span>
            {e.periodEnd ? (
              <span className="mt-1 block text-xs font-normal text-muted">
                تا {faDate(e.periodEnd)}
              </span>
            ) : null}
          </Fact>
          <Fact label="اپلای روزانه">
            {apply.limit === null
              ? "نامحدود"
              : `${toFaDigits(apply.usedToday)} از ${toFaDigits(apply.limit)} امروز`}
          </Fact>
          <Fact label="اپلای ۲۴ ساعته روی سرور">
            {e.workerIpLimit > 0 ? `${toFaDigits(e.workerIpLimit)} ورکر` : "ندارد"}
          </Fact>
          <Fact label="کیف‌پولِ واحد">
            <span className="ltr-nums">{formatToman(balanceToman)} تومان</span>
            <a
              href={ONEXAI_TOPUP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring mt-1 block text-xs font-normal text-brand hover:underline"
            >
              شارژِ کیف‌پول ↗
            </a>
          </Fact>
        </div>
      </Card>
      <Callout icon={<IconWallet />} title="اشتراک با اعتبارِ کیف‌پول فرق دارد">
        هزینه‌ی پردازش‌های هوش مصنوعی ابتدا از اعتبارِ اشتراکِ 1xAi و بعد از کیف‌پول کسر می‌شود.
      </Callout>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-base font-bold">{children}</div>
    </div>
  );
}

interface OnexaiPlan {
  key: string;
  name_fa: string;
  price_toman: number;
  features?: { company?: boolean; karjoo_unlimited_applies?: boolean; karjoo_worker_ips?: number };
}

async function loadPlans(): Promise<OnexaiPlan[]> {
  const base = onexaiSvcConfig()?.baseUrl ?? "https://1xai.ir";
  try {
    const res = await fetch(`${base}/api/plans`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { plans?: OnexaiPlan[] };
    return (body.plans ?? []).filter((p) => !p.features?.company);
  } catch {
    return [];
  }
}

async function PlansTable() {
  const plans = await loadPlans();
  if (plans.length === 0) {
    return (
      <Callout tone="info" title="فهرستِ پلن‌ها در دسترس نیست">
        پلن‌ها و قیمت‌ها را در{" "}
        <a href={ONEXAI_PLANS_URL} className="text-brand hover:underline">
          1xai.ir/plans
        </a>{" "}
        ببین.
      </Callout>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-extrabold">مزایای کارجو در هر پلنِ 1xAi</h2>
      <TableFrame minWidth="32rem">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-border text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">پلن</th>
              <th className="px-4 py-3 font-medium">قیمتِ ماهانه</th>
              <th className="px-4 py-3 font-medium">اپلای روزانه</th>
              <th className="px-4 py-3 font-medium">اپلای روی سرور</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const workers = p.features?.karjoo_worker_ips ?? 0;
              return (
                <tr key={p.key} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-bold">{p.name_fa}</td>
                  <td className="ltr-nums px-4 py-3">
                    {p.price_toman > 0 ? `${formatToman(p.price_toman)} تومان` : "رایگان"}
                  </td>
                  <td className="px-4 py-3">
                    {p.features?.karjoo_unlimited_applies
                      ? "نامحدود"
                      : `${toFaDigits(FREE_APPLY_QUOTA_PER_DAY)} در روز`}
                  </td>
                  <td className="px-4 py-3">
                    {workers > 0 ? `${toFaDigits(workers)} ورکر` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={ONEXAI_PLAN_URL}>خرید یا تغییرِ اشتراک</ButtonLink>
        <ButtonLink href={ONEXAI_PLANS_URL} variant="secondary">
          مقایسه‌ی کاملِ پلن‌ها در 1xAi
        </ButtonLink>
      </div>
    </section>
  );
}
