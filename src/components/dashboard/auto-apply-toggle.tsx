"use client";

/**
 * پنلِ کنترلِ «اپلای خودکار» (client component) — تاگلِ رضایت + اسلایدرِ آستانه.
 *
 * تنظیماتِ اولیه از سرور (RSC) می‌آید؛ این کامپوننت فقط تغییرات را با
 * PUT /api/auto-apply می‌فرستد (بدنه: { enabled?, minScore? }) و نتیجه را نشان می‌دهد،
 * سپس router.refresh تا RSCها (ردِ ممیزی/وضعیت) تازه شوند.
 *
 * رضایتِ صریح: تاگل پیش‌فرض خاموش است و فقط با کلیکِ خودِ کاربر روشن می‌شود. متنِ کنارِ
 * تاگل دقیقاً می‌گوید چه کاری انجام می‌شود، که قابلِ لغو است و یادآوریِ ToS/حساب را دارد.
 *
 * هیچ توکن/رازی نمی‌بیند؛ فقط با کوکیِ نشستِ httpOnly کار می‌کند (مرورگر خودش می‌فرستد).
 * userId هرگز از کلاینت فرستاده نمی‌شود — سرور آن را از نشست می‌گیرد (§۱۰/قاعده‌ی ۴).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, toFaDigits } from "./ui";

/** پاسخِ GET/PUT /api/auto-apply. */
interface AutoApplyResult {
  enabled?: boolean;
  minScore?: number;
  error?: string;
}

export function AutoApplyToggle({
  initialEnabled,
  initialMinScore,
  /** آیا کاربر دستِ‌کم یک حسابِ متصلِ آماده دارد؟ (برای هشدارِ پیش‌نیاز). */
  hasReadyBoard,
}: {
  initialEnabled: boolean;
  initialMinScore: number;
  hasReadyBoard: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  // اسلایدر با درصدِ صحیح (۰..۱۰۰) کار می‌کند؛ هنگامِ ارسال به ۰..۱ تبدیل می‌شود.
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
      const res = await fetch("/api/auto-apply", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data: AutoApplyResult = await res.json().catch(() => ({}));
      if (!res.ok || data.enabled === undefined) {
        setError(data.error ?? "ذخیره‌ی تنظیمات ناموفق بود.");
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
          ? "اپلای خودکار روشن شد. کارجو فقط فرصت‌های بالاتر از آستانه را در محدوده‌ی سقفِ روزانه اپلای می‌کند."
          : "اپلای خودکار خاموش شد. هیچ اپلای خودکاری انجام نمی‌شود.",
      );
      router.refresh();
    }
  }

  /** ذخیره‌ی آستانه (هنگامِ رهاکردنِ اسلایدر، تا روی هر پیکسل درخواست نرود). */
  async function onCommitScore() {
    if (busy) return;
    const ok = await persist({ minScore: scorePct / 100 });
    if (ok) {
      setNotice(`آستانه‌ی امتیاز به ${toFaDigits(scorePct)}٪ تنظیم شد.`);
      router.refresh();
    }
  }

  return (
    <Card className="p-6">
      {/* ───── تاگلِ رضایت ───── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-bold">اپلای خودکار</h3>
          <p className="mt-1 text-sm leading-7 text-muted">
            با روشن‌کردنِ این گزینه، کارجو از طرفِ شما برای فرصت‌هایی که امتیازِ تطبیقِ
            آن‌ها از آستانه‌ی شما بالاتر است و در محدوده‌ی سقفِ روزانه قرار دارند،
            <strong className="text-foreground"> به‌صورت خودکار </strong>
            اپلای می‌کند. اپلای در مرورگرِ خودتان و با نشستِ خودتان روی سایت‌های متصل
            انجام می‌شود.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="تاگلِ اپلای خودکار"
          onClick={onToggle}
          disabled={busy}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            enabled ? "bg-brand" : "bg-foreground/15"
          }`}
        >
          {/* در RTL، حالتِ روشن دایره را به چپ می‌برد. */}
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "-translate-x-6" : "-translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* وضعیتِ فعلیِ تاگل */}
      <div className="mt-4">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            enabled
              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
              : "bg-foreground/5 text-muted"
          }`}
        >
          <span aria-hidden>{enabled ? "🟢" : "⚪"}</span>
          {enabled ? "روشن — رضایت فعال است" : "خاموش — هیچ اپلای خودکاری انجام نمی‌شود"}
        </span>
      </div>

      {/* هشدارِ پیش‌نیاز: حسابِ متصلِ آماده */}
      {enabled && !hasReadyBoard ? (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-6 text-amber-700 dark:text-amber-400">
          ⚠️ هنوز حسابِ متصلِ آماده‌ای ندارید. تا وقتی یک سایتِ پشتیبانی‌شده را با افزونه
          متصل نکنید، اپلای خودکار عملاً اجرا نمی‌شود.
        </p>
      ) : null}

      {/* ───── اسلایدرِ آستانه ───── */}
      <div className="mt-6 border-t border-border/70 pt-5">
        <div className="flex items-center justify-between">
          <label htmlFor="min-score" className="text-sm font-medium">
            آستانه‌ی امتیازِ تطبیق
          </label>
          <span className="ltr-nums rounded-full bg-brand/10 px-2.5 py-0.5 text-sm font-bold text-brand">
            {toFaDigits(scorePct)}٪
          </span>
        </div>
        <p className="mt-1 text-xs leading-6 text-muted">
          فقط فرصت‌هایی که امتیازِ تطبیقِ آن‌ها از این مقدار بالاتر باشد به‌صورت خودکار
          اپلای می‌شوند. مقدارِ بالاتر = اپلای کم‌تر اما دقیق‌تر.
        </p>
        <input
          id="min-score"
          type="range"
          min={0}
          max={100}
          step={5}
          value={scorePct}
          onChange={(e) => setScorePct(Number(e.target.value))}
          onPointerUp={onCommitScore}
          onKeyUp={onCommitScore}
          disabled={busy}
          className="mt-3 w-full accent-[var(--brand)] disabled:opacity-60"
          aria-valuetext={`${scorePct} درصد`}
        />
      </div>

      {/* ───── یادآوریِ ToS/لغو ───── */}
      <p className="mt-5 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs leading-6 text-muted">
        🔒 این تنظیم هر زمان قابلِ لغو است؛ کافی‌ست تاگل را خاموش کنید. توجه: اپلای خودکار
        ممکن است با شرایطِ استفاده‌ی برخی سایت‌ها سازگار نباشد و مسئولیتِ حسابِ کاربری بر
        عهده‌ی شماست. کارجو هرگز از مکانیزمِ تشخیصِ ربات عبور نمی‌کند و فقط با نشستِ واقعیِ
        خودِ شما عمل می‌کند.
      </p>

      {/* پیام‌ها */}
      {error ? (
        <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}
