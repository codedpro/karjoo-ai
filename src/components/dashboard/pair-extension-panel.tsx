"use client";

/**
 * پنلِ «اتصالِ افزونه» — یک کدِ جفت‌سازیِ یک‌بارمصرف می‌سازد تا افزونه با آن pair شود.
 *
 * قاعده‌ی CONTEXT (۵): افزونه با هندآفِ یک‌بارمصرف pair می‌شود، نه phone-OTP دوم.
 * این کامپوننت POST /api/auth/extension/pair را صدا می‌زند (با کوکیِ نشستِ وب) و کدِ
 * خام را فقط همین‌جا، موقتاً، نمایش می‌دهد. کد کوتاه‌عمر است؛ شمارشِ معکوس نشان داده
 * می‌شود. هیچ رازِ سرور/توکنی اینجا hard-code نیست — همه از پاسخِ امنِ سرور می‌آید.
 */
import { useEffect, useState } from "react";

import { toFaDigits } from "./ui";

interface PairResponse {
  /** کدِ جفت‌سازیِ خام برای واردکردن در افزونه (فیلدِ قراردادِ مسیرِ pair). */
  pairingCode?: string;
  /** زمانِ انقضا (ISO) — برای شمارشِ معکوس. */
  expiresAt?: string;
  error?: string;
}

function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}

export function PairExtensionPanel() {
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // «اکنون» را هر ثانیه (داخلِ callbackِ تایمر) به‌روز می‌کنیم؛ `remaining` در زمانِ
  // رندر از روی expiresAt مشتق می‌شود. این‌طور setState همگام‌سازی‌شده در بدنه‌ی effect
  // نداریم (پرهیز از رندرِ آبشاری).
  const [nowTs, setNowTs] = useState(() => Date.now());

  // تیکِ شمارشِ معکوس — همه‌ی setStateها داخلِ callbackِ تایمر رخ می‌دهند (مجاز؛ نه در
  // بدنه‌ی effect). وقتی کد منقضی شد، همان‌جا پاکش می‌کنیم تا effectِ جداگانه‌ای که
  // setState همگام داشته باشد لازم نشود.
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      const t = Date.now();
      if (secondsLeft(expiresAt, t) <= 0) {
        setCode(null);
        setExpiresAt(null);
      } else {
        setNowTs(t);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const remaining = expiresAt ? secondsLeft(expiresAt, nowTs) : 0;

  async function generate() {
    setError(null);
    setCopied(false);
    setPending(true);
    try {
      const res = await fetch("/api/auth/extension/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data: PairResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data.pairingCode) {
        setError(data.error ?? "ساختِ کدِ اتصال ناموفق بود. دوباره تلاش کنید.");
        return;
      }
      setCode(data.pairingCode);
      setNowTs(Date.now());
      setExpiresAt(data.expiresAt ?? null);
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // اگر clipboard در دسترس نبود، کاربر دستی کپی می‌کند.
    }
  }

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const timeLabel = `${toFaDigits(mm)}:${toFaDigits(String(ss).padStart(2, "0"))}`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-2xl">
          🧩
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold">اتصال افزونه‌ی مرورگر</h3>
          <p className="mt-1 text-sm leading-7 text-muted">
            افزونه‌ی کارجو در مرورگرِ خودتان، با تأییدِ شما اپلای را پیش‌نویس می‌کند.
            برای اتصال، یک کدِ یک‌بارمصرف بسازید و آن را در افزونه وارد کنید — نیازی به
            ورودِ دوباره‌ی شماره نیست.
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : null}

      {code ? (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-brand/40 bg-brand/5 px-4 py-3">
            <code className="ltr-nums select-all break-all text-sm font-bold tracking-wide text-foreground">
              {code}
            </code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              {copied ? "کپی شد ✓" : "کپی"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            این کد یک‌بارمصرف است و تا{" "}
            <span className="ltr-nums font-medium text-foreground">{timeLabel}</span> دیگر
            معتبر است.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="mt-5 w-full rounded-full bg-gradient-to-l from-brand to-brand-2 px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto sm:px-8"
        >
          {pending ? "در حال ساخت…" : "ساخت کد اتصال"}
        </button>
      )}
    </div>
  );
}
