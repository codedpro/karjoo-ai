"use client";

/**
 * پنلِ کیف‌پول (client component) — موجودیِ کیف‌پولِ *واحدِ 1xAi* + نشانِ پلن.
 *
 * «یک انسان، یک موجودی»: پول در 1xai زندگی می‌کند؛ کارجو فقط نمایش می‌دهد. فرمِ
 * کارت‌به‌کارت/فهرستِ درخواست‌ها حذف شده — شارژ *فقط* در داشبوردِ 1xai انجام می‌شود
 * (لینکِ https://1xai.ir/topup). هیچ توکن/رازی اینجا نیست؛ فقط کوکیِ نشستِ httpOnly.
 *
 * `unavailable`: اگر سرور نتوانست موجودیِ واحد را بخواند (svc در دسترس نبود)، به‌جای
 * موجودیِ جعلی، حالتِ «کیف‌پول موقتاً در دسترس نیست» رندر می‌شود (تنزلِ نمایشی).
 */
import { IconWallet } from "./icons";
import { Badge, ButtonLink, Card, cn, toFaDigits } from "./ui";
import { PLAN_BADGE } from "./wallet-labels";
import { formatToman } from "./wallet-format";
import type { Plan } from "@/db/schema";

/** نشانیِ یکتای شارژِ کیف‌پولِ واحد (خانواده‌ی 1xAi). */
const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

export function WalletPanel({
  initialBalanceToman,
  plan,
  unavailable = false,
}: {
  initialBalanceToman: number;
  plan: Plan;
  /** موجودیِ واحد خوانده نشد (svc در دسترس نیست) → حالتِ تنزل‌یافته. */
  unavailable?: boolean;
}) {
  const planBadge = PLAN_BADGE[plan] ?? PLAN_BADGE.payg;
  const lowBalance = !unavailable && initialBalanceToman <= 0;

  return (
    <Card padded>
      {/* ───── موجودی + نشانِ پلن ───── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-muted">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"
              aria-hidden
            >
              <IconWallet className="h-5 w-5" />
            </span>
            <h2 className="text-sm font-medium">موجودیِ کیف‌پول</h2>
          </div>
          {unavailable ? (
            <p className="mt-2 text-lg font-bold text-muted">—</p>
          ) : (
            <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
              <span
                className={cn(
                  "ltr-nums text-3xl font-extrabold tracking-tight",
                  lowBalance ? "text-rose-500" : "text-foreground",
                )}
              >
                {toFaDigits(formatToman(initialBalanceToman))}
              </span>
              <span className="text-sm text-muted">تومان</span>
            </div>
          )}
        </div>
        <Badge tone={planBadge.tone} title={planBadge.title}>
          {planBadge.label}
        </Badge>
      </div>

      {unavailable ? (
        <p
          role="status"
          className="mt-4 text-pretty rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-xs leading-6 text-amber-700 dark:text-amber-400"
        >
          کیف‌پول موقتاً در دسترس نیست. موجودیِ شما دست‌نخورده در 1xai محفوظ است؛ کمی
          بعد دوباره تلاش کنید.
        </p>
      ) : lowBalance ? (
        <p className="mt-4 text-pretty rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
          موجودیِ شما صفر است. برای استفاده از سرویس‌های هوش مصنوعی (تطبیق، انگیزه‌نامه،
          پردازشِ رزومه) ابتدا کیف‌پول را در 1xai شارژ کنید.
        </p>
      ) : null}

      {/* ───── شارژ — فقط در داشبوردِ 1xai ───── */}
      <div className="mt-5 border-t border-border pt-5">
        <p className="text-pretty text-xs leading-6 text-muted">
          کیف‌پولِ شما همان کیف‌پولِ 1xAi است — یک موجودی برای همه‌ی محصولات.
        </p>
        <ButtonLink
          href={ONEXAI_TOPUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 w-full"
        >
          شارژِ کیف‌پول در 1xai ↗
        </ButtonLink>
      </div>
    </Card>
  );
}
