"use client";

/**
 * تاگلِ «فیلترِ هوشمند (AI)» (client component) — لایه‌ی اختیاریِ پریمیوم روی فیلترمود.
 *
 * فقط برای کاربرِ واجدِ استحقاق رندر می‌شود (کارتِ سرور پیش از این چک کرده). این کامپوننت
 * صرفاً تغییرِ تاگل را با PUT /api/apply/ai-filter می‌فرستد و سپس router.refresh می‌کند.
 * اگر سرور با ۴۰۲ (بی‌استحقاق شدن، مثلاً موجودی صفر شد) پاسخ دهد، تاگل را *روشن نمی‌کند*
 * و پیامِ ارتقا نشان می‌دهد (fail-closed). هیچ توکن/رازی نمی‌بیند؛ userId هرگز از کلاینت
 * نمی‌رود — سرور از نشست می‌گیرد (§۱۰/قاعده‌ی ۴).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card, cn } from "./ui";
import { IconSparkle, IconShield } from "./icons";

/** پاسخِ PUT /api/apply/ai-filter (AiFilterGateState یا { error }). */
interface AiFilterResult {
  enabled?: boolean;
  entitled?: boolean;
  aiFilter?: boolean;
  error?: string;
}

export function AiFilterToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onToggle() {
    if (busy) return;
    const next = !enabled;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/apply/ai-filter", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data: AiFilterResult = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.enabled !== "boolean") {
        // ۴۰۲ = بی‌استحقاق؛ تاگل را روشن نکن (خاموش می‌ماند) و پیام بده.
        setError(data.error ?? "ذخیره‌ی فیلترِ هوشمند ناموفق بود.");
        return;
      }
      setEnabled(data.enabled);
      setNotice(
        data.enabled
          ? "فیلترِ هوشمند روشن شد. کارجو از میانِ شغل‌های فیلترشده فقط مواردِ متناسب با رزومه‌ی شما را نگه می‌دارد."
          : "فیلترِ هوشمند خاموش شد. کارجو به همه‌ی شغل‌های فیلترشده اپلای می‌کند.",
      );
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors",
              enabled ? "bg-brand/12 text-brand" : "bg-foreground/5 text-muted",
            )}
            aria-hidden
          >
            <IconSparkle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-balance text-base font-bold leading-tight">
              فیلترِ هوشمند (AI)
            </h3>
            <p className="mt-1.5 text-pretty text-sm leading-7 text-muted">
              یک لایه‌ی <strong className="font-semibold text-foreground">اختیاری</strong> روی
              فیلترهای بالا: وقتی روشن باشد، کارجو از میانِ شغل‌هایی که فیلترِ خودِ سایت برگردانده،
              فقط مواردِ متناسب با <strong className="font-semibold text-foreground">رزومه‌ی شما</strong>
              را نگه می‌دارد. وقتی خاموش باشد، به <strong className="font-semibold text-foreground">همه‌ی</strong>
              شغل‌های فیلترشده اپلای می‌شود.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="روشن/خاموش‌کردنِ فیلترِ هوشمند"
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

      {/* وضعیتِ فعلی */}
      <div className="mt-4">
        <span
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
            enabled
              ? "bg-brand/12 text-brand ring-brand/15"
              : "bg-foreground/5 text-muted ring-foreground/10",
          )}
        >
          <span
            className={cn("h-2 w-2 rounded-full", enabled ? "bg-brand" : "bg-muted/60")}
            aria-hidden
          />
          {enabled
            ? "روشن — فقط شغل‌های متناسب با رزومه اپلای می‌شوند"
            : "خاموش — همه‌ی شغل‌های فیلترشده اپلای می‌شوند"}
        </span>
      </div>

      {/* یادآوریِ «AI پولی است / اختیاری است» */}
      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border bg-surface/50 px-4 py-3 text-muted">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-pretty text-xs leading-6">
          این لایه از هوش مصنوعی استفاده می‌کند و هزینه‌اش از موجودیِ کیف‌پولِ شما کسر می‌شود.
          هر لحظه می‌توانید خاموشش کنید؛ مسیرِ پایه (اپلای به همه‌ی شغل‌های فیلترشده) همیشه رایگان
          و در دسترس است.
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
