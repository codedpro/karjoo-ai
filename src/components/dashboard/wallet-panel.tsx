"use client";

/**
 * پنلِ کیف‌پول (client component) — موجودی + نشانِ پلن + شارژِ کارت‌به‌کارت.
 *
 * جریانِ شارژ: کاربر مبلغ را به کارتِ مقصد (از سرور) منتقل می‌کند، سپس مبلغ و کدِ پیگیری
 * را ثبت می‌کند → POST /api/wallet/topup یک درخواستِ `pending` می‌سازد (هیچ اعتباری اضافه
 * نمی‌شود). کیف‌پول فقط پس از *تأییدِ ادمین* شارژ می‌شود. هیچ توکن/رازی اینجا نیست؛ فقط
 * کوکیِ نشستِ httpOnly. userId هرگز از کلاینت نمی‌رود.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IconWallet } from "./icons";
import { Badge, Button, Card, cn, toFaDigits } from "./ui";
import { PLAN_BADGE } from "./wallet-labels";
import { formatToman } from "./wallet-format";
import type { Plan } from "@/db/schema";

/** مبالغِ پیشنهادیِ شارژ (تومان) — هم‌راستا با MIN/MAX در billing-schemas. */
const PRESET_AMOUNTS = [50_000, 100_000, 200_000, 500_000] as const;

/** اطلاعاتِ کارتِ مقصد (از سرور؛ null اگر پیکربندی نشده). */
export interface CardInfo {
  cardNumber: string;
  holder: string;
  bank?: string;
}

/** یک درخواستِ پرداختِ کاربر (برای فهرستِ وضعیت). */
export interface RequestItem {
  id: string;
  kind: "topup" | "plan";
  amountToman: number;
  status: "pending" | "approved" | "rejected";
  referenceCode: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<
  RequestItem["status"],
  { label: string; tone: "amber" | "green" | "rose" }
> = {
  pending: { label: "در انتظارِ تأیید", tone: "amber" },
  approved: { label: "تأیید شد", tone: "green" },
  rejected: { label: "رد شد", tone: "rose" },
};

export function WalletPanel({
  initialBalanceToman,
  plan,
  card,
  initialRequests,
}: {
  initialBalanceToman: number;
  plan: Plan;
  card: CardInfo | null;
  initialRequests: RequestItem[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState<number>(PRESET_AMOUNTS[1]);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [requests, setRequests] = useState<RequestItem[]>(initialRequests);

  const planBadge = PLAN_BADGE[plan] ?? PLAN_BADGE.payg;
  const lowBalance = initialBalanceToman <= 0;

  async function copyCard() {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.cardNumber.replace(/[\s-]/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  async function handleSubmit() {
    setError(null);
    setNotice(null);
    if (!reference.trim()) {
      setError("لطفاً کدِ پیگیریِ تراکنشِ کارت‌به‌کارت را وارد کنید.");
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountToman: amount, referenceCode: reference.trim() }),
        signal: controller.signal,
      });
      const data: { ok?: boolean; error?: string; request?: RequestItem } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || !data.ok || !data.request) {
        setError(data.error ?? "ثبتِ درخواستِ شارژ ناموفق بود.");
        return;
      }
      const req = data.request;
      setRequests((prev) => [
        {
          id: req.id,
          kind: "topup",
          amountToman: req.amountToman,
          status: req.status,
          referenceCode: req.referenceCode ?? null,
          createdAt: req.createdAt,
        },
        ...prev,
      ]);
      setNotice(
        "درخواستِ شارژ ثبت شد و در انتظارِ تأیید است. پس از بررسیِ پرداخت، کیف‌پول شارژ می‌شود.",
      );
      setReference("");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "AbortError"
          ? "درخواست بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید."
          : "اتصال به سرور برقرار نشد.",
      );
    } finally {
      clearTimeout(timer);
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
              <IconWallet className="h-5 w-5" />
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
              {toFaDigits(formatToman(initialBalanceToman))}
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

      {/* ───── شارژِ کارت‌به‌کارت ───── */}
      <div className="mt-5 border-t border-border pt-5">
        <h3 className="text-sm font-bold">شارژِ کیف‌پول (کارت‌به‌کارت)</h3>

        {!card ? (
          <p className="mt-3 text-pretty rounded-xl border border-border bg-surface/60 px-3.5 py-3 text-xs leading-6 text-muted">
            شارژِ کارت‌به‌کارت هنوز فعال نشده است. لطفاً کمی بعد دوباره تلاش کنید.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">
              مبلغِ دلخواه را به کارتِ زیر منتقل کنید، سپس مبلغ و کدِ پیگیری را ثبت کنید. پس
              از بررسیِ پرداخت، کیف‌پول شارژ می‌شود.
            </p>

            {/* کارتِ مقصد */}
            <div className="mt-3 rounded-xl border border-border bg-surface/60 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="ltr-nums font-mono text-base tracking-[0.2em] text-foreground"
                  dir="ltr"
                >
                  {card.cardNumber}
                </span>
                <button
                  type="button"
                  onClick={copyCard}
                  className="focus-ring shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground"
                >
                  {copied ? "کپی شد ✓" : "کپی"}
                </button>
              </div>
              <div className="mt-1.5 text-xs text-muted">
                به نامِ <strong className="text-foreground">{card.holder}</strong>
                {card.bank ? ` — ${card.bank}` : ""}
              </div>
            </div>

            {/* مبلغ */}
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
                    aria-checked={active}
                    onClick={() => setAmount(preset)}
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

            {/* کدِ پیگیری */}
            <label className="mt-3 block text-xs font-medium text-muted" htmlFor="ref-code">
              کدِ پیگیریِ تراکنش
            </label>
            <input
              id="ref-code"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              inputMode="numeric"
              placeholder="کدِ رهگیریِ کارت‌به‌کارت را وارد کنید"
              className="focus-ring mt-1 w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted"
            />

            <Button type="button" onClick={handleSubmit} disabled={busy} className="mt-4 w-full">
              {busy ? (
                "در حال ثبت…"
              ) : (
                <span className="whitespace-nowrap">
                  ثبتِ درخواستِ شارژِ{" "}
                  <span className="ltr-nums">{toFaDigits(formatToman(amount))}</span> تومان
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
          </>
        )}

        {/* درخواست‌های اخیر + وضعیت */}
        {requests.length > 0 ? (
          <div className="mt-5 border-t border-border pt-4">
            <h4 className="text-xs font-bold text-muted">درخواست‌های اخیر</h4>
            <ul className="mt-2 space-y-1.5">
              {requests.map((r) => {
                const b = STATUS_BADGE[r.status];
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"
                  >
                    <span className="flex items-center gap-2">
                      <span className="ltr-nums font-semibold text-foreground">
                        {toFaDigits(formatToman(r.amountToman))} ت
                      </span>
                      <span className="text-muted">
                        {r.kind === "plan" ? "ارتقای پلن" : "شارژ"}
                      </span>
                    </span>
                    <Badge tone={b.tone}>{b.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
