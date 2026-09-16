/**
 * چیپِ کیف‌پول و اشتراک در هدرِ داشبورد (Server component، داخلِ `<Suspense>`).
 *
 * موجودی و اشتراک هر دو در 1xai زندگی می‌کنند؛ این چیپ همان عددها را نشان می‌دهد و به
 * صفحه‌ی شارژ/اشتراکِ 1xai لینک می‌دهد. اگر 1xai در دسترس نباشد، به‌جای عددِ غلط «—».
 */
import { getDashboardUser } from "./session";
import { toFaDigits } from "./ui";
import { ONEXAI_TOPUP_URL } from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
import { getUnifiedBalance } from "@/lib/billing/unified";

function formatToman(n: number): string {
  return toFaDigits(Math.round(n).toLocaleString("en-US")).replace(/,/g, "٬");
}

export async function DashboardWalletChip() {
  const user = await getDashboardUser();
  if (!user) return null;

  const [balance, entitlements] = await Promise.all([
    getUnifiedBalance(user.userId).catch(() => null),
    readEntitlements(user.userId),
  ]);

  const amount = balance
    ? balance.unlimited
      ? "نامحدود"
      : `${formatToman(balance.availableToman)} تومان`
    : "—";

  return (
    <div className="flex items-center gap-2">
      <a
        href="/dashboard/plans"
        className="focus-ring hidden h-9 items-center border border-hairline-strong px-2.5 text-xs text-bone-dim transition-colors hover:border-persimmon/40 hover:text-bone md:inline-flex"
        title="اشتراکِ واحدِ 1xAi و کارجو"
      >
        اشتراک: <span className="ms-1 font-semibold text-bone">{entitlements.planNameFa}</span>
      </a>
      <a
        href={ONEXAI_TOPUP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring inline-flex h-9 items-center gap-1.5 border border-hairline-strong px-2.5 text-xs transition-colors hover:border-persimmon/40"
        title="کیف‌پولِ واحدِ 1xAi — برای شارژ کلیک کنید"
      >
        <span className="text-bone-dim">کیف پول</span>
        <span className="ltr-nums font-semibold text-bone">{amount}</span>
      </a>
    </div>
  );
}

export function DashboardWalletChipSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="skeleton-shimmer hidden h-9 w-28 bg-bone/[0.06] md:block" />
      <div className="skeleton-shimmer h-9 w-32 bg-bone/[0.06]" />
    </div>
  );
}
