"use client";

/**
 * بنرِ «نگه‌داریِ هوش مصنوعی» (client component) — WF3 Track B.
 *
 * /api/ai-status را می‌خواند و اگر سرویس در حالتِ نگه‌داری باشد (سقفِ بودجه‌ی ماهانه
 * رسیده یا پرچمِ دستیِ ادمین روشن)، یک بنرِ هشدارِ فارسی نشان می‌دهد تا کاربر بداند چرا
 * کنش‌های هوش مصنوعی موقتاً کار نمی‌کنند. قابلیت‌های غیر-AI (آپلود، اپلای، ایمپورت)
 * دست‌نخورده‌اند — این بنر فقط درباره‌ی کنش‌های پولیِ AI است.
 *
 * این کامپوننت هیچ رقمِ بودجه/دلاری نمی‌بیند؛ فقط boolean + reason (cap|manual) که
 * /api/ai-status برمی‌گرداند. هیچ رازی، هیچ مبلغی. در صورتِ خطای شبکه fail-open
 * (بنری نشان نمی‌دهد) — گیتِ واقعی همیشه سمتِ سرور است.
 *
 * onStatus (اختیاری) به والد اجازه می‌دهد دکمه‌های AI را در حالتِ نگه‌داری غیرفعال کند.
 */
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

import {
  AI_STATUS_AVAILABLE,
  maintenanceMessage,
  parseAiStatus,
  type AiStatus,
} from "@/lib/billing/guardrail-ui";

/** بازه‌ی پیش‌فرضِ بازخوانیِ وضعیت (۶۰ ثانیه) — به‌اندازه‌ی کافی تازه، بدونِ فشارِ شبکه. */
const DEFAULT_POLL_MS = 60_000;

export function AiMaintenanceBanner({
  pollMs = DEFAULT_POLL_MS,
  onStatus,
}: {
  /** بازه‌ی بازخوانی به میلی‌ثانیه (۰ یا منفی = بدونِ بازخوانیِ دوره‌ای، فقط یک‌بار). */
  pollMs?: number;
  /** فراخوانیِ والد با هر تغییرِ وضعیت — تا دکمه‌های AI را غیرفعال کند. */
  onStatus?: (status: AiStatus) => void;
}) {
  const [status, setStatus] = useState<AiStatus>(AI_STATUS_AVAILABLE);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/ai-status", { cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        const next = res.ok ? parseAiStatus(body) : AI_STATUS_AVAILABLE;
        setStatus(next);
        onStatus?.(next);
      } catch {
        // خطای شبکه → وضعیتِ امن (در دسترس)؛ UI را قفل نکن.
        if (cancelled) return;
        setStatus(AI_STATUS_AVAILABLE);
        onStatus?.(AI_STATUS_AVAILABLE);
      }
    }

    void load();
    const id =
      pollMs > 0 ? setInterval(() => void load(), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [pollMs, onStatus]);

  if (!status.maintenance) return null;

  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400"
          aria-hidden
        >
          <Wrench strokeWidth={1.75} className="h-5 w-5 shrink-0" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-balance text-sm font-bold text-amber-800 dark:text-amber-300">
            سرویسِ هوش مصنوعی موقتاً در دسترس نیست
          </h4>
          <p className="mt-1 text-pretty text-sm leading-7 text-amber-700/90 dark:text-amber-200/80">
            {maintenanceMessage(status.reason)}
          </p>
          <p className="mt-1 text-pretty text-xs leading-6 text-amber-700/80 dark:text-amber-200/70">
            بقیه‌ی قابلیت‌ها (آپلودِ رزومه، اپلای، ایمپورت و داشبورد) عادی کار می‌کنند.
            کنش‌های هوش مصنوعی به‌محضِ رفعِ محدودیت دوباره فعال می‌شوند.
          </p>
        </div>
      </div>
    </div>
  );
}
