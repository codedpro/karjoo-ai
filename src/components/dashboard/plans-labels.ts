/**
 * برچسب‌ها و کمک‌کننده‌های نمایشیِ صفحه‌ی پلن‌ها (Track A).
 *
 * صرفاً نگاشتِ نمایشی/خالص است؛ هیچ I/O، هیچ راز. عمداً جدا از `labels.ts` و
 * `wallet-labels.ts` نگه داشته شده تا تداخلِ مالکیتی نباشد. اعداد جای دیگری با
 * `toFaDigits` فارسی می‌شوند.
 */
import type { PlanKey } from "@/lib/billing/plans";

/** لحنِ نشانِ هر پلن — هم‌خوان با تُن‌های Badge در ui.tsx. */
export const PLAN_TONE: Record<PlanKey, "muted" | "brand" | "accent"> = {
  free: "muted",
  pro: "brand",
  max: "accent",
  maxplus: "accent",
};

/**
 * متنِ سهمیه‌ی اپلای را برای نمایش می‌سازد: عدد برای سقف‌دار، «نامحدود» برای null.
 * عدد لاتین می‌ماند تا با toFaDigits یک‌جا فارسی شود.
 */
export function applyQuotaLabel(quotaPerDay: number | null): string {
  return quotaPerDay === null ? "نامحدود" : `${quotaPerDay} در روز`;
}

/** متنِ تعدادِ IPِ ورکرِ auto-apply (۰ → «—»). */
export function workerIpLabel(workerIpLimit: number): string {
  return workerIpLimit > 0 ? `${workerIpLimit} IP` : "—";
}

/**
 * برچسبِ CTAِ یک پلن نسبت به پلنِ فعلیِ کاربر:
 *   • همان پلن  → «پلنِ فعلی»
 *   • گران‌تر   → «ارتقا به …»
 *   • ارزان‌تر  → «تغییر به …» (پایین‌آوردن)
 */
export function ctaLabel(
  isCurrent: boolean,
  isUpgrade: boolean,
  labelFa: string,
): string {
  if (isCurrent) return "پلنِ فعلی";
  if (isUpgrade) return `ارتقا به ${labelFa}`;
  return `تغییر به ${labelFa}`;
}
