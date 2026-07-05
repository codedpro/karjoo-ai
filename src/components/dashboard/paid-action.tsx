/**
 * اجزای UIِ «کنشِ پولی» — افوردنسِ مشترکِ گیتینگ + هزینه (Track C).
 *
 * ارائه‌ای و سبک؛ هیچ I/O / رازی ندارند. سه قطعه:
 *   • <CostHint>     — نشانِ کوچکِ «حدودِ هزینه» کنارِ دکمه‌ی کنشِ پولی (تخمین).
 *   • <FreeBadge>    — نشانِ «رایگان» برای کنش‌های همیشه‌رایگان (آپلودِ PDF، اپلای).
 *   • <TopupPrompt>  — بنرِ «نیازمندِ شارژ» که هنگامِ پاسخِ ۴۰۲ نشان داده می‌شود.
 *
 * این‌ها هیچ مدلی صدا نمی‌زنند و هیچ موجودیِ واقعی کسر نمی‌کنند؛ صرفاً پیام/تخمین را
 * نشان می‌دهند. محاسبه‌ی تخمین در src/lib/billing/ui.ts (خالص) انجام می‌شود.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { IconCheck, IconWallet } from "./icons";
import {
  formatCostHint,
  formatToman,
  type CostEstimate,
  type TopupNeeded,
} from "@/lib/billing/ui";

/**
 * نشانِ «حدودِ هزینه» — تخمینِ پیش از کنش (توکنِ تخمینی × قیمتِ مدل × حاشیه).
 * اگر estimate نباشد (مثلاً کاتالوگ بارگذاری نشده)، چیزی نشان نمی‌دهد.
 */
export function CostHint({
  estimate,
  className = "",
}: {
  estimate: CostEstimate | null | undefined;
  className?: string;
}) {
  if (!estimate) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400 ${className}`}
      title={`تخمین بر اساس مدلِ ${estimate.displayName} — هزینه‌ی واقعی پس از پردازش از مصرفِ واقعی محاسبه می‌شود.`}
    >
      <IconWallet className="h-3.5 w-3.5" />
      {formatCostHint(estimate)}
    </span>
  );
}

/** نشانِ «رایگان» — برای کنش‌هایی که هرگز هزینه نمی‌گیرند (آپلودِ PDF، اپلای). */
export function FreeBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      <IconCheck className="h-3.5 w-3.5" />
      رایگان
    </span>
  );
}

/**
 * بنرِ «نیازمندِ شارژ» — هنگامِ پاسخِ ۴۰۲ از یک کنشِ پولی نمایش داده می‌شود.
 * یک دکمه/لینکِ شارژ (onTopup یا topupHref) و امکانِ بستن می‌دهد.
 *
 * هیچ موجودیِ واقعی نمی‌خواند؛ فقط پیامِ آمده از سرور را نشان می‌دهد.
 */
export function TopupPrompt({
  topup,
  balanceToman,
  onTopup,
  topupHref,
  onDismiss,
}: {
  topup: TopupNeeded;
  /** اگر موجودیِ فعلی معلوم باشد، نمایش داده می‌شود (اختیاری). */
  balanceToman?: number;
  onTopup?: () => void;
  topupHref?: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400"
          aria-hidden
        >
          <IconWallet className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-bold text-amber-800 dark:text-amber-300">
            شارژِ حساب لازم است
          </h4>
          <p className="mt-1 text-sm leading-7 text-amber-700/90 dark:text-amber-200/80">
            {topup.message}
          </p>
          {typeof balanceToman === "number" ? (
            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">
              موجودیِ فعلی:{" "}
              <span className="ltr-nums font-medium">{formatToman(balanceToman)}</span>
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TopupButton onTopup={onTopup} topupHref={topupHref} />
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-full px-4 py-2 text-sm font-medium text-amber-700/80 transition-colors hover:text-amber-800 dark:text-amber-200/70"
              >
                بستن
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** دکمه‌ی شارژ — اگر href داده شد لینک، وگرنه دکمه‌ی onTopup. */
function TopupButton({
  onTopup,
  topupHref,
}: {
  onTopup?: () => void;
  topupHref?: string;
}): ReactNode {
  const cls =
    "rounded-full bg-brand px-5 py-2 text-sm font-bold text-brand-foreground shadow-xs transition-transform hover:-translate-y-0.5 hover:brightness-110";
  if (topupHref) {
    return (
      <a href={topupHref} className={cls}>
        شارژِ کیف‌پول
      </a>
    );
  }
  return (
    <button type="button" onClick={onTopup} className={cls}>
      شارژِ کیف‌پول
    </button>
  );
}

/**
 * توضیحِ کوچکِ «این کنش پولی است» — یک خطِ راهنمای زیرِ دکمه، با تخمینِ هزینه.
 * برای جاهایی که می‌خواهیم شفاف باشیم کنش هزینه دارد (پیش از فشردنِ دکمه).
 */
export function PaidActionNote({
  estimate,
  description,
}: {
  estimate: CostEstimate | null | undefined;
  description?: string;
}) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <Info strokeWidth={1.75} className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {description ?? "این کنش از هوش مصنوعی استفاده می‌کند و پولی است."}
      </span>
      {estimate ? (
        <span className="text-amber-700 dark:text-amber-400">
          ({formatCostHint(estimate)})
        </span>
      ) : null}
    </p>
  );
}
