"use client";

/**
 * مرزِ خطای سراسری (global-error) — کارجو.
 *
 * این کامپوننت فقط وقتی رندر می‌شود که خطا در *خودِ layout ریشه* رخ دهد؛ در آن حالت
 * layout ریشه (و پرووایدرها) دیگر در دسترس نیستند، پس این‌جا باید تگ‌های <html>/<body>
 * خودمان را رندر کنیم و *فقط* از استایلِ inline استفاده کنیم (نه Tailwind، نه کامپوننتِ
 * مشترک، نه توکن‌های CSS — چون globals.css ممکن است بارگذاری نشده باشد).
 *
 * این آخرین سنگرِ گزارش است: خطاهایی که layout ریشه را می‌کشند از هر مرزِ دیگری عبور
 * می‌کنند، پس بدونِ این هرگز به Sentry نمی‌رسند. captureException الگوی مستندِ Next 16
 * برای global-error است (مثلِ Fabric-Commerce).
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { source: "global-error", digest: error.digest ?? "unknown" },
    });
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            fontFamily:
              'Vazirmatn, Tahoma, "Segoe UI", system-ui, -apple-system, sans-serif',
            backgroundColor: "#070a13",
            color: "#eef1f8",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem 1rem",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "5rem",
                height: "5rem",
                borderRadius: "1.25rem",
                backgroundColor: "rgba(91, 61, 245, 0.16)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "1.5rem",
              }}
              aria-hidden="true"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#8b5cf6"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </div>

            <h1
              style={{
                fontSize: "1.75rem",
                fontWeight: 700,
                margin: "0 0 0.5rem",
                letterSpacing: "-0.01em",
              }}
            >
              مشکلی پیش آمد
            </h1>
            <p
              style={{
                color: "#94a3b8",
                margin: "0 0 2rem",
                maxWidth: "28rem",
                lineHeight: 1.8,
                fontSize: "0.95rem",
              }}
            >
              بابتِ این وقفه پوزش می‌خواهیم. تیمِ ما به‌طورِ خودکار مطلع شد و در حالِ بررسی
              است. لطفاً دوباره تلاش کنید یا به صفحه‌ی نخست بازگردید.
            </p>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  padding: "0.75rem 1.75rem",
                  backgroundColor: "#5b3df5",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "0.75rem",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  fontFamily: "inherit",
                }}
              >
                تلاش دوباره
              </button>
              {/*
                در global-error، layout ریشه (و router context) از کار افتاده؛ next/link
                که به آن context متکی است این‌جا قابل‌اتکا نیست. یک <a> با ناوبریِ کاملِ
                صفحه (hard navigation) عمداً استفاده می‌شود — الگوی مستندِ Next برای
                global-error (مثلِ Fabric-Commerce).
              */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                style={{
                  padding: "0.75rem 1.75rem",
                  backgroundColor: "transparent",
                  color: "#d1d5db",
                  border: "1px solid #1e2640",
                  borderRadius: "0.75rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                بازگشت به خانه
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
