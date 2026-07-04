import "server-only";

/**
 * کارتِ «فیلترِ هوشمند (AI)» (Server component) — نقطه‌ی ورودِ Track A روی صفحه‌ی apply-filters.
 *
 * Track A مالکِ صفحه است و فقط این کارت را رندر می‌کند:
 * ```tsx
 * import { AiFilterToggleCard } from "@/components/dashboard/ai-filter-card";
 * <Suspense fallback={<AiFilterCardSkeleton />}>
 *   <AiFilterToggleCard userId={userId} />
 * </Suspense>
 * ```
 * کارت خودکفاست: وضعیتِ گیت را می‌خواند (getAiFilterGateState) و تصمیم می‌گیرد:
 *   • واجدِ استحقاق  → تاگلِ کارآمد (AiFilterToggle).
 *   • بی‌استحقاق     → کارتِ دعوت به شارژ/ارتقا (بدونِ تاگلِ کارآمد) — قاعده: «Free/بی‌موجودی
 *     دعوت به ارتقا می‌بیند، نه تاگل». AI هرگز الزامی نیست؛ مسیرِ پایه‌ی همه‌ی این کاربران
 *     «اپلای به همه‌ی شغل‌های فیلترشده» است.
 *
 * `userId` اختیاری است — اگر داده نشود از نشست گرفته می‌شود (getDashboardUser)، تا Track A
 * بتواند حتی بدونِ prop رندرش کند. مقید به همان userId (قاعده‌ی ۴).
 */
import { getDashboardUser } from "@/components/dashboard/session";
import { getAiFilterGateState } from "@/lib/apply/ai-gate";
import { formatToman } from "@/lib/billing/ui";

import { AiFilterToggle } from "./ai-filter-toggle";
import { Badge, ButtonLink, Card } from "./ui";
import { IconSparkle, IconWallet } from "./icons";

export async function AiFilterToggleCard({ userId }: { userId?: string }) {
  let uid = userId;
  if (!uid) {
    const user = await getDashboardUser();
    if (!user) return null;
    uid = user.userId;
  }

  const state = await getAiFilterGateState(uid);

  if (!state.entitled) {
    return <AiFilterUpgradePrompt balanceToman={state.balanceToman} />;
  }

  return <AiFilterToggle initialEnabled={state.enabled} />;
}

/**
 * دعوت به شارژ/ارتقا برای کاربرِ بی‌استحقاق (موجودی ≤ ۰) — به‌جای تاگلِ کارآمد.
 * لحنِ مثبت: پیش‌فرضِ رایگانِ «اپلای به همه‌ی شغل‌های فیلترشده» تأکید می‌شود تا کاربر گیر نکند.
 */
function AiFilterUpgradePrompt({ balanceToman }: { balanceToman: number }) {
  return (
    <Card padded>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/8 text-brand"
            aria-hidden
          >
            <IconSparkle className="h-5 w-5" />
          </span>
          <h3 className="text-balance text-base font-bold leading-tight">
            فیلترِ هوشمند (AI)
          </h3>
        </div>
        <Badge tone="accent">پریمیوم</Badge>
      </div>

      <p className="mt-3 text-pretty text-sm leading-7 text-muted">
        فیلترِ هوشمند یک لایه‌ی <strong className="font-semibold text-foreground">اختیاری</strong> است
        که از میانِ شغل‌های فیلترشده فقط مواردِ متناسب با رزومه‌ی شما را نگه می‌دارد. این قابلیت از
        هوش مصنوعی استفاده می‌کند و برای فعال‌سازی به موجودیِ کیف‌پول نیاز دارد.
      </p>

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <IconWallet className="h-4 w-4" />
        موجودیِ فعلی: <span className="ltr-nums font-medium">{formatToman(balanceToman)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ButtonLink href="/dashboard/billing" size="sm">
          شارژِ کیف‌پول
        </ButtonLink>
        <ButtonLink href="/dashboard/plans" variant="secondary" size="sm">
          مشاهده‌ی پلن‌ها
        </ButtonLink>
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface/50 px-4 py-3 text-muted">
        <p className="text-pretty text-xs leading-6">
          نیازی به این کار نیست تا شروع کنید: مسیرِ پایه‌ی کارجو «اپلای به{" "}
          <strong className="font-semibold text-foreground">همه‌ی</strong> شغل‌های فیلترشده» است و
          کاملاً رایگان کار می‌کند. فیلترِ هوشمند فقط برای باریک‌ترکردنِ فهرست است.
        </p>
      </div>
    </Card>
  );
}

/** اسکلتِ هم‌شکلِ کارت — برای Suspense fallback در صفحه‌ی Track A. */
export function AiFilterCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-xs" aria-hidden>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2.5">
          <div className="skeleton-shimmer h-5 w-40 rounded-lg bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-full rounded bg-foreground/[0.06]" />
          <div className="skeleton-shimmer h-3.5 w-4/5 rounded bg-foreground/[0.06]" />
        </div>
        <div className="skeleton-shimmer h-7 w-12 shrink-0 rounded-full bg-foreground/[0.06]" />
      </div>
      <div className="skeleton-shimmer mt-6 h-12 w-full rounded-xl bg-foreground/[0.06]" />
    </div>
  );
}
