"use client";

/**
 * پنلِ کیف‌پول (client component) — موجودی + نشانِ پلن + CTAِ شارژ.
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

import { Badge, Card, toFaDigits } from "./ui";
import { PLAN_BADGE } from "./wallet-labels";
import { formatToman } from "./wallet-format";
import type { Plan } from "@/db/schema";

/** مبالغِ پیشنهادیِ شارژ (تومان) — هم‌راستا با MIN/MAX در billing-schemas. */
const PRESET_AMOUNTS = [50_000, 100_000, 200_000, 500_000] as const;

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
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-muted">موجودیِ کیف‌پول</h2>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`ltr-nums text-3xl font-extrabold ${
                lowBalance ? "text-rose-500" : "text-foreground"
              }`}
            >
              {toFaDigits(formatToman(balanceToman))}
            </span>
            <span className="text-sm text-muted">تومان</span>
          </div>
        </div>
        <Badge tone={planBadge.tone}>
          <span title={planBadge.title}>پلن: {planBadge.label}</span>
        </Badge>
      </div>

      {lowBalance ? (
        <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-3.5 py-2.5 text-xs leading-6 text-rose-600 dark:text-rose-400">
          موجودیِ شما صفر است. برای استفاده از سرویس‌های هوش مصنوعی (تطبیق، انگیزه‌نامه،
          پردازشِ رزومه) ابتدا کیف‌پول را شارژ کنید.
        </p>
      ) : null}

      {/* ───── شارژ (STUBِ توسعه‌ای) ───── */}
      <div className="mt-5 border-t border-border pt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">شارژِ کیف‌پول</h3>
          <Badge tone="amber">آزمایشی</Badge>
        </div>
        <p className="mt-1 text-xs leading-6 text-muted">
          درگاهِ پرداختِ واقعی (زرین‌پال) به‌زودی فعال می‌شود. این شارژ صرفاً برای آزمایشِ
          سرویس است و پرداختِ واقعی ندارد.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESET_AMOUNTS.map((preset) => {
            const active = preset === amount;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border bg-card text-muted hover:text-foreground"
                }`}
              >
                <span className="ltr-nums">{toFaDigits(formatToman(preset))}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleTopup}
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy
            ? "در حال شارژ…"
            : `شارژِ ${toFaDigits(formatToman(amount))} تومان (آزمایشی)`}
        </button>

        {error ? (
          <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
            {notice}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
