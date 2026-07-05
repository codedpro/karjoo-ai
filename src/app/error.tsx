"use client";

/**
 * مرزِ خطای کلاینت (App Router) — کارجو.
 *
 * Next.js این کامپوننت را وقتی نشان می‌دهد که یک خطای رندر/داده در زیرشاخه‌ی مسیر
 * (زیرِ layout ریشه) رخ دهد. دو کار می‌کند:
 *   ۱) خطا را به Sentry گزارش می‌دهد (تنها راهِ رسیدنِ خطاهای رندرِ سمتِ کلاینت به هاب).
 *   ۲) یک UIِ فارسیِ RTL با دکمه‌ی «تلاش دوباره» (reset) و «بازگشت به خانه» نشان می‌دهد،
 *      با توکن‌های طراحیِ کارجو (globals.css) — نه استایلِ خام.
 *
 * نکته‌ها:
 *   • «use client» لازم است (error boundaryها باید کلاینتی باشند و reset را بگیرند).
 *   • خطاهای NEXT_REDIRECT (redirect داخلی) خطای واقعی نیستند؛ آن‌ها را نه گزارش می‌دهیم
 *     و نه UIِ خطا نشان می‌دهیم — می‌گذاریم Next خودش هدایت را انجام دهد.
 *   • هیچ hookی که به context متکی باشد (useTheme/useSession) استفاده نمی‌کنیم تا در
 *     پری‌رندر خطای «useContext of null» ندهد.
 */
import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // redirectهای داخلیِ Next خطای واقعی نیستند — نباید به Sentry بروند یا UIِ خطا بدهند.
  const isRedirect =
    error?.digest?.startsWith("NEXT_REDIRECT") ||
    error?.message?.includes("NEXT_REDIRECT");

  useEffect(() => {
    if (isRedirect) return;
    // تنها مسیرِ رسیدنِ خطاهای رندرِ کلاینت به هاب؛ tenant تگ در initialScope ست شده،
    // اینجا فقط منبع/digest را اضافه می‌کنیم تا در استریمِ Sentry قابلِ تفکیک باشند.
    Sentry.captureException(error, {
      tags: { source: "app-error-boundary", digest: error.digest ?? "unknown" },
    });
  }, [error, isRedirect]);

  // پس از همه‌ی hookها (ترتیبِ hook پایدار بماند) — برای redirect چیزی رندر نکن.
  if (isRedirect) return null;

  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* آیکنِ هشدار — با رنگِ برندِ کارجو */}
        <div
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl"
          style={{ backgroundColor: "color-mix(in oklab, var(--brand) 14%, transparent)" }}
          aria-hidden="true"
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">مشکلی پیش آمد</h1>
          <p className="text-muted text-sm leading-7">
            بابتِ این وقفه پوزش می‌خواهیم. تیمِ ما به‌طورِ خودکار مطلع شد و در حالِ بررسی
            است. می‌توانید دوباره تلاش کنید یا به صفحه‌ی نخست بازگردید.
          </p>
        </div>

        {process.env.NODE_ENV === "development" && error?.message && (
          <pre
            className="ltr-nums overflow-auto rounded-lg border p-4 text-left font-mono text-xs"
            style={{
              backgroundColor: "var(--surface)",
              color: "#ef4444",
              borderColor: "var(--border)",
            }}
          >
            {error.message}
          </pre>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-brand-foreground transition-[filter] hover:brightness-95"
            style={{ backgroundColor: "var(--brand)", boxShadow: "var(--shadow-brand)" }}
          >
            تلاش دوباره
          </button>
          <Link
            href="/"
            className="focus-ring inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            بازگشت به خانه
          </Link>
        </div>
      </div>
    </div>
  );
}
