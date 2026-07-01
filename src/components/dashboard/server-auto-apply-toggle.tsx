"use client";

/**
 * پنلِ کنترلِ «اپلای خودکارِ سرور» (client component) — تاگلِ رضایتِ سطحِ *سرور* + آستانه.
 *
 * سطحِ سرور مستقل از تاگلِ افزونه است: اپلای ۲۴ ساعته روی ناوگانِ ایرانیِ کارجو، بدونِ نیاز
 * به بازبودنِ مرورگر. فقط برای پلن‌های Max/Max+ رندر می‌شود (صفحه پیش از این کامپوننت
 * eligibility را چک می‌کند)؛ اگر سرور با ۴۰۳/not_entitled پاسخ دهد، پیامِ ارتقا نشان داده و
 * تاگل به حالتِ راستینِ سرور برگردانده می‌شود (fail-closed).
 *
 * تنظیماتِ اولیه از RSC می‌آید؛ این کامپوننت فقط تغییرات را با PUT /api/server-auto-apply
 * می‌فرستد (بدنه: { enabled?, minScore? }) و سپس router.refresh تا پنل‌های وضعیت تازه شوند.
 * هیچ توکن/رازی نمی‌بیند؛ userId هرگز از کلاینت نمی‌رود — سرور از نشست می‌گیرد (§۱۰/قاعده‌ی ۴).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, cn, toFaDigits } from "./ui";
import { IconServer, IconShield, IconTarget } from "./icons";

/** پاسخِ GET/PUT /api/server-auto-apply. */
interface ServerAutoApplyResult {
  enabled?: boolean;
  minScore?: number;
  error?: string;
}

export function ServerAutoApplyToggle({
  initialEnabled,
  initialMinScore,
}: {
  initialEnabled: boolean;
  initialMinScore: number;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [scorePct, setScorePct] = useState(Math.round(initialMinScore * 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** یک تغییر را به سرور می‌فرستد و state/پیام را به‌روزرسانی می‌کند. */
  async function persist(patch: { enabled?: boolean; minScore?: number }) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/server-auto-apply", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data: ServerAutoApplyResult = await res.json().catch(() => ({}));
      if (!res.ok || data.enabled === undefined) {
        setError(
          data.error ??
            "ذخیره‌ی تنظیماتِ اپلای خودکارِ سرور ناموفق بود.",
        );
        return false;
      }
      setEnabled(data.enabled);
      if (typeof data.minScore === "number") {
        setScorePct(Math.round(data.minScore * 100));
      }
      return true;
    } catch {
      setError("اتصال به سرور برقرار نشد.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onToggle() {
    if (busy) return;
    const next = !enabled;
    const ok = await persist({ enabled: next });
    if (ok) {
      setNotice(
        next
          ? "اپلای خودکارِ سرور روشن شد. کارجو فرصت‌های بالاتر از آستانه را ۲۴ ساعته و بدونِ نیاز به افزونه اپلای می‌کند."
          : "اپلای خودکارِ سرور خاموش شد. ناوگان دیگر برای شما اپلای نمی‌کند.",
      );
      router.refresh();
    }
  }

  /** ذخیره‌ی آستانه (هنگامِ رهاکردنِ اسلایدر). */
  async function onCommitScore() {
    if (busy) return;
    const ok = await persist({ minScore: scorePct / 100 });
    if (ok) {
      setNotice(`آستانه‌ی امتیازِ سرور به ${toFaDigits(scorePct)}٪ تنظیم شد.`);
      router.refresh();
    }
  }

  return (
    <Card padded>
      {/* ───── تاگلِ رضایتِ سطحِ سرور ───── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors",
              enabled ? "bg-brand/12 text-brand" : "bg-foreground/5 text-muted",
            )}
            aria-hidden
          >
            <IconServer className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-balance text-base font-bold leading-tight">
              فعال‌سازیِ اپلای خودکارِ سرور
            </h3>
            <p className="mt-1.5 text-pretty text-sm leading-7 text-muted">
              با روشن‌کردنِ این گزینه، ناوگانِ کارجو از طرفِ شما فرصت‌های بالاتر از آستانه را{" "}
              <strong className="font-semibold text-foreground">
                ۲۴ ساعته و بدونِ افزونه
              </strong>{" "}
              اپلای می‌کند — با نشستِ رمزشده‌ی خودتان در خزانه، حتی وقتی مرورگرتان بسته است.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="روشن/خاموش‌کردنِ اپلای خودکارِ سرور"
          onClick={onToggle}
          disabled={busy}
          className={cn(
            "focus-ring relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
            enabled ? "bg-brand" : "bg-foreground/15",
          )}
        >
          {/* در RTL، حالتِ روشن دایره را به چپ می‌برد. */}
          <span
            className={cn(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              enabled ? "-translate-x-6" : "-translate-x-1",
            )}
          />
        </button>
      </div>

      {/* وضعیتِ فعلیِ تاگلِ سرور */}
      <div className="mt-4">
        <span
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
            enabled
              ? "bg-emerald-500/12 text-emerald-600 ring-emerald-500/15 dark:text-emerald-400"
              : "bg-foreground/5 text-muted ring-foreground/10",
          )}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              enabled ? "bg-emerald-500" : "bg-muted/60",
            )}
            aria-hidden
          />
          {enabled
            ? "روشن — ناوگان برای شما اپلای می‌کند"
            : "خاموش — ناوگان اپلای نمی‌کند"}
        </span>
      </div>

      {/* ───── اسلایدرِ آستانه ───── */}
      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="server-min-score"
            className="inline-flex items-center gap-2 text-sm font-medium"
          >
            <IconTarget className="h-4 w-4 text-muted" />
            آستانه‌ی امتیازِ تطبیق (سرور)
          </label>
          <span className="ltr-nums whitespace-nowrap rounded-full bg-brand/10 px-2.5 py-0.5 text-sm font-bold text-brand">
            {toFaDigits(scorePct)}٪
          </span>
        </div>
        <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">
          ناوگان فقط فرصت‌هایی را که امتیازِ تطبیقشان از این مقدار بالاتر است اپلای می‌کند.
          مقدارِ بالاتر یعنی اپلای کم‌تر اما دقیق‌تر.
        </p>
        <input
          id="server-min-score"
          type="range"
          min={0}
          max={100}
          step={5}
          value={scorePct}
          onChange={(e) => setScorePct(Number(e.target.value))}
          onPointerUp={onCommitScore}
          onKeyUp={onCommitScore}
          disabled={busy}
          className="focus-ring mt-3 w-full accent-brand disabled:opacity-60"
          aria-valuetext={`${scorePct} درصد`}
        />
      </div>

      {/* ───── یادآوریِ امنیت/لغو ───── */}
      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border bg-surface/50 px-4 py-3 text-muted">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-pretty text-xs leading-6">
          این تنظیم هر لحظه قابلِ لغو است؛ کافی‌ست تاگل را خاموش کنید. ناوگان فقط با نشستِ
          واقعیِ خودتان عمل می‌کند؛ کلیدِ خزانه هرگز کنترل‌پلین را ترک نمی‌کند و هیچ سازوکارِ
          تشخیصِ ربات دور زده نمی‌شود.
        </p>
      </div>

      {/* پیام‌ها */}
      {error ? (
        <p
          role="alert"
          className="mt-4 text-pretty rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 text-pretty rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
