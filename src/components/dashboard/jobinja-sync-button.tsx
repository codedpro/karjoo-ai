"use client";

/**
 * دکمه‌ی «به‌روزرسانی از سایت» (client, RTL) — یک سایتِ کاریابی را از راهِ نشستِ خزانه‌ی
 * سرور همگام می‌کند: POST به endpoint (پیش‌فرض: `/api/boards/jobinja/sync`، کوکیِ نشستِ وب)،
 * سپس `router.refresh()` تا کارت‌های سرورِ صفحه (قیف + فهرست) با داده‌ی تازه دوباره رندر شوند.
 *
 * board-agnostic نگه داشته شده تا فاز ۴ هم بتواند از همین دکمه استفاده کند: فقط `label` و
 * (در صورتِ نیاز) `endpoint` را عوض کن.
 *
 * حالت‌های صادقانه:
 *   • ۲۰۰ + ok:true  → «به‌روزرسانی شد» (+ تعدادِ درخواست‌های خوانده‌شده).
 *   • ۴۰۹ (no_session) یا ۲۰۰ + ok:false → نشستِ سایت وصل/سالم نیست → «ابتدا … را از افزونه وصل کنید».
 *   • ۴۰۱ → نشستِ کارجو منقضی شده؛ دوباره وارد شوید.
 *   • بقیه → خطای عمومیِ محترمانه.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button, cn, toFaDigits } from "./ui";
import { IconCheck } from "./icons";

/** پیامِ «هنوز وصل نیست» — پیش‌فرضِ جابینجا؛ با پراپ قابلِ‌جایگزینی برای سایت‌های دیگر. */
const DEFAULT_NOT_CONNECTED = "ابتدا جابینجا را از افزونه وصل کنید.";

type SyncTone = "success" | "info" | "error";

interface SyncView {
  tone: SyncTone;
  text: string;
}

const TONE_BOX: Record<SyncTone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  info: "border border-border bg-surface/70 text-muted",
  error: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_AUTO_SYNC_KEY = "karjoo:jobinja:auto-sync:last";

async function postSync(endpoint: string): Promise<{
  res: Response;
  data: { ok?: boolean; applications?: number; error?: string };
}> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    applications?: number;
    error?: string;
  };
  return { res, data };
}

export function JobinjaSyncButton({
  label,
  endpoint = "/api/boards/jobinja/sync",
  notConnectedMessage = DEFAULT_NOT_CONNECTED,
  className,
}: {
  /** متنِ دکمه (مثلِ «به‌روزرسانی از جابینجا»). */
  label: string;
  /** مسیرِ POSTِ همگام‌سازی (پیش‌فرضِ جابینجا؛ برای سایت‌های دیگر عوض کن). */
  endpoint?: string;
  /** پیامِ «سایت وصل نیست» (۴۰۹) — قابلِ‌جایگزینی برای هر سایت. */
  notConnectedMessage?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<SyncView | null>(null);

  const busy = pending || refreshing;

  async function run() {
    if (busy) return;
    setView(null);
    setPending(true);
    try {
      const { res, data } = await postSync(endpoint);

      // نشستِ سایت وصل/سالم نیست: ۴۰۹ (no_session) یا ۲۰۰ با ok:false (کوکی/رمزگشایی خراب).
      if (res.status === 409 || (res.ok && data.ok === false)) {
        setView({ tone: "info", text: notConnectedMessage });
        return;
      }
      if (res.status === 401) {
        setView({ tone: "error", text: "نشستِ شما منقضی شده؛ دوباره وارد شوید." });
        return;
      }
      if (!res.ok) {
        setView({
          tone: "error",
          text: data.error ?? "به‌روزرسانی ناموفق بود. کمی بعد دوباره تلاش کنید.",
        });
        return;
      }

      // موفق — تعدادِ درخواست‌های خوانده‌شده را (اگر بود) در پیام بیاور، سپس سرور را تازه کن.
      const n = typeof data.applications === "number" ? data.applications : 0;
      setView({
        tone: "success",
        text:
          n > 0
            ? `به‌روزرسانی شد؛ ${toFaDigits(n)} درخواست از جابینجا خوانده شد.`
            : "به‌روزرسانی شد.",
      });
      startRefresh(() => router.refresh());
    } catch {
      setView({ tone: "error", text: "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-2 sm:items-end", className)}>
      <Button
        type="button"
        onClick={run}
        disabled={busy}
        variant="secondary"
        size="sm"
        aria-busy={busy}
        className="shrink-0"
      >
        <RefreshCw
          className={cn("h-4 w-4", busy && "animate-spin")}
          strokeWidth={1.75}
          aria-hidden
        />
        {pending ? "در حالِ همگام‌سازی…" : label}
      </Button>

      {view ? (
        <p
          role={view.tone === "error" ? "alert" : "status"}
          className={cn(
            "text-pretty rounded-xl px-3.5 py-2 text-xs leading-6 sm:max-w-xs",
            TONE_BOX[view.tone],
          )}
        >
          {view.tone === "success" ? (
            <IconCheck className="me-1.5 inline h-4 w-4 align-[-2px]" />
          ) : null}
          {view.text}
        </p>
      ) : null}
    </div>
  );
}

export function JobinjaAutoSync({
  endpoint = "/api/boards/jobinja/sync",
  storageKey = DEFAULT_AUTO_SYNC_KEY,
  intervalMs = AUTO_SYNC_INTERVAL_MS,
}: {
  endpoint?: string;
  storageKey?: string;
  intervalMs?: number;
}) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const now = Date.now();
    const last = Number.parseInt(sessionStorage.getItem(storageKey) ?? "0", 10);
    if (Number.isFinite(last) && last > 0 && now - last < intervalMs) return;
    sessionStorage.setItem(storageKey, String(now));

    let cancelled = false;
    void postSync(endpoint)
      .then(({ res, data }) => {
        if (cancelled) return;
        if (res.ok && data.ok !== false) router.refresh();
      })
      .catch(() => {
        // Best-effort background sync. The visible button remains the explicit error surface.
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, intervalMs, router, storageKey]);

  return null;
}
