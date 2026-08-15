"use client";

/**
 * پنلِ کیف‌پول (client component) — موجودیِ کیف‌پولِ *واحدِ 1xAi* + مسیرِ روشنِ شارژ.
 *
 * «یک انسان، یک موجودی»: پول در 1xai زندگی می‌کند؛ کارجو فقط نمایش می‌دهد و هیچ پرداختی
 * نمی‌گیرد (جریانِ کارت‌به‌کارتِ درون‌برنامه‌ای بازنشسته شده و `POST /api/wallet/topup`
 * الان ۴۱۰ برمی‌گرداند).
 *
 * تصمیمِ اصلیِ این فایل: «شارژ در 1xai انجام می‌شود» به‌تنهایی یک بن‌بست است — وسطِ یک
 * جریانِ پرداخت، کاربر را به جایی می‌فرستد بدونِ اینکه بگوید آن‌جا چه می‌بیند و بعدش چه.
 * پس مسیر در سه گامِ شمرده آمده (ورود با همان حساب → پرداختِ آنلاین یا کارت‌به‌کارت →
 * بازگشت) و دکمه‌ی «به‌روزرسانیِ موجودی» همان‌جاست تا کاربر بعدِ بازگشت نتیجه را ببیند.
 *
 * `unavailable`: اگر سرور نتوانست موجودیِ واحد را بخواند (svc در دسترس نبود)، به‌جای
 * موجودیِ جعلی، حالتِ «کیف‌پول موقتاً در دسترس نیست» رندر می‌شود (تنزلِ نمایشی).
 */
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { IconRefresh, IconWallet } from "./icons";
import { Badge, Button, ButtonLink, Card, cn, toFaDigits } from "./ui";
import { PLAN_BADGE } from "./wallet-labels";
import { formatToman } from "./wallet-format";
import type { Plan } from "@/db/schema";

/** نشانیِ یکتای شارژِ کیف‌پولِ واحد (خانواده‌ی 1xAi). */
const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

/** گام‌های شارژ — کوتاه و به‌ترتیبِ انجام؛ کاربر باید بداند بعدِ کلیک چه می‌بیند. */
const TOPUP_STEPS = [
  "در 1xai با همان حسابی که به کارجو وارد شده‌ای وارد شو.",
  "مبلغ را با پرداختِ آنلاین یا کارت‌به‌کارت شارژ کن.",
  "به همین صفحه برگرد و موجودی را به‌روزرسانی کن.",
];

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
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
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
          موجودی صفر است — تا شارژ نشود، تطبیق، انگیزه‌نامه و رزومه‌ی سفارشی کار نمی‌کنند.
        </p>
      ) : null}

      {/* ───── مسیرِ شارژ: سه گامِ روشن + اکشنِ اصلی ───── */}
      <div className="mt-5 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">شارژِ کیف‌پول</h3>
        <ol className="mt-2.5 space-y-1.5">
          {TOPUP_STEPS.map((step, i) => (
            <li key={step} className="flex gap-2 text-pretty text-xs leading-6 text-muted">
              <span
                className="ltr-nums mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand/10 text-[0.65rem] font-bold text-brand"
                aria-hidden
              >
                {toFaDigits(i + 1)}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <ButtonLink
          href={ONEXAI_TOPUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 w-full"
        >
          رفتن به صفحه‌ی شارژِ 1xai ↗
        </ButtonLink>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="mt-2 w-full"
        >
          <IconRefresh className={cn("h-4 w-4", refreshing && "animate-spin")} />
          {refreshing ? "در حالِ به‌روزرسانی…" : "به‌روزرسانیِ موجودی"}
        </Button>

        <p className="mt-3 text-pretty text-xs leading-6 text-muted">
          کیف‌پولِ کارجو و 1xAi یکی است — یک موجودی برای همه‌ی محصولات.
        </p>
      </div>
    </Card>
  );
}
