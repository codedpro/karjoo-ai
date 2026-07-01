"use client";

/**
 * پنلِ کیف‌پول (client component) — موجودی + نشانِ پلن + شارژ.
 *
 * موجودیِ اولیه از سرور (RSC) می‌آید؛ این کامپوننت فقط شارژ را مدیریت می‌کند:
 * فرمِ انتخابِ مبلغ → POST /api/wallet/topup (STUBِ توسعه‌ای، نه پرداختِ واقعی) →
 * به‌روزرسانیِ موجودیِ نمایشی + router.refresh تا RSCها (دفتر/مصرف) تازه شوند.
 *
 * هیچ توکن/رازی نمی‌بیند؛ فقط با کوکیِ نشستِ httpOnly کار می‌کند (مرورگر خودش کوکی را
 * می‌فرستد). userId هرگز از کلاینت فرستاده نمی‌شود — سرور آن را از نشست می‌گیرد.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Card, cn, toFaDigits } from "./ui";
import { PLAN_BADGE } from "./wallet-labels";
import { formatToman } from "./wallet-format";
import type { Plan } from "@/db/schema";

/** مبالغِ پیشنهادیِ شارژ (تومان) — هم‌راستا با MIN/MAX در billing-schemas. */
const PRESET_AMOUNTS = [50_000, 100_000, 200_000, 500_000] as const;

/** آیکنِ کیف‌پول (SVG سبک، بدونِ ایموجی) — تزئینی. */
function WalletIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-5 w-5"
      aria-hidden
    >
      <path
        d="M3 8.5A2.5 2.5 0 0 1 5.5 6H18a2 2 0 0 1 2 2v1H6.5a1.5 1.5 0 0 0 0 3H20v4a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 15.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="16.5" cy="10.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function WalletPanel({
  initialBalanceToman,
  plan,
}: {
  initialBalanceToman: number;
  plan: Plan;
}) {
  const router = useRouter();
  const [balanceToman, setBalanceToman] = useState(initialBalanceToman);
  const [amount, setAmount] = useState<number>(PRESET_AMOUNTS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const planBadge = PLAN_BADGE[plan] ?? PLAN_BADGE.payg;
  const lowBalance = balanceToman <= 0;

  async function handleTopup() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountToman: amount }),
      });
      const data: {
        error?: string;
        ok?: boolean;
        balanceToman?: number;
        creditedToman?: number;
      } = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok || typeof data.balanceToman !== "number") {
        setError(data.error ?? "شارژِ کیف‌پول ناموفق بود.");
        return;
      }

      setBalanceToman(data.balanceToman);
      setNotice(
        `کیف‌پول ${toFaDigits(formatToman(data.creditedToman ?? amount))} تومان شارژ شد (آزمایشی).`,
      );
      // RSCها (دفتر/تاریخچه‌ی مصرف) را با داده‌ی تازه دوباره بخوان.
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

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
              <WalletIcon />
            </span>
            <h2 className="text-sm font-medium">موجودیِ کیف‌پول</h2>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
            <span
              className={cn(
                "ltr-nums text-3xl font-extrabold tracking-tight",
                lowBalance ? "text-rose-500" : "text-foreground",
              )}
            >
              {toFaDigits(formatToman(balanceToman))}
            </span>
            <span className="text-sm text-muted">تومان</span>
          </div>
        </div>
        <Badge tone={planBadge.tone} title={planBadge.title}>
          {planBadge.label}
        </Badge>
      </div>

      {lowBalance ? (
        <p className="mt-4 text-pretty rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
          موجودیِ شما صفر است. برای استفاده از سرویس‌های هوش مصنوعی (تطبیق، انگیزه‌نامه،
          پردازشِ رزومه) ابتدا کیف‌پول را شارژ کنید.
        </p>
      ) : null}

      {/* ───── شارژ (STUBِ توسعه‌ای) ───── */}
      <div className="mt-5 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">شارژِ کیف‌پول</h3>
          <Badge tone="amber">آزمایشی</Badge>
        </div>
        <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">
          درگاهِ پرداختِ واقعی (زرین‌پال) به‌زودی فعال می‌شود. این شارژ صرفاً برای آزمایشِ
          سرویس است و پرداختِ واقعی ندارد.
        </p>

        <div
          role="radiogroup"
          aria-label="مبلغِ شارژ"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PRESET_AMOUNTS.map((preset) => {
            const active = preset === amount;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                onClick={() => setAmount(preset)}
                aria-checked={active}
                className={cn(
                  "focus-ring rounded-xl border px-3 py-2 text-sm font-semibold transition-[background-color,border-color,transform] duration-150 active:translate-y-px",
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground",
                )}
              >
                <span className="ltr-nums">{toFaDigits(formatToman(preset))}</span>
              </button>
            );
          })}
        </div>

        <Button
          type="button"
          onClick={handleTopup}
          disabled={busy}
          className="mt-4 w-full"
        >
          {busy ? (
            "در حال شارژ…"
          ) : (
            <span className="whitespace-nowrap">
              شارژِ{" "}
              <span className="ltr-nums">{toFaDigits(formatToman(amount))}</span>{" "}
              تومان
            </span>
          )}
        </Button>

        {error ? (
          <p
            role="alert"
            className="mt-3 text-pretty rounded-lg bg-rose-500/10 px-3 py-2 text-xs leading-6 text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mt-3 text-pretty rounded-lg bg-emerald-500/10 px-3 py-2 text-xs leading-6 text-emerald-600 dark:text-emerald-400"
          >
            {notice}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
