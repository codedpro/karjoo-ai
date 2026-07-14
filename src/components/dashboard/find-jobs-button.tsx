"use client";

/**
 * دکمه‌ی «جست‌وجوی مشاغل» (client component, RTL) — تنها راهِ راه‌اندازیِ
 * POST /api/apply/find-jobs از داشبورد. کاربر فیلترهایش را ذخیره می‌کند و سپس با این
 * دکمه، سرور همان جست‌وجو را scrape و آگهی‌های تازه را به صفِ اپلای اضافه می‌کند.
 *
 * این اقدام *مستقل از ذخیره* است: بدنه‌ی خالی `{}` پست می‌شود (سرور کاربر را از نشست و
 * فیلترها را از پروفایل می‌گیرد؛ مکان‌نمای صفحه‌بندی هم سمتِ سرور پیش می‌رود — کلاینت
 * هیچ شماره‌ی صفحه‌ای نمی‌فرستد).
 *
 * پاسخ به‌صورتِ *دفاعی* تفسیر می‌شود: فقط به فیلدهای مستند تکیه می‌کنیم و فیلدهای ناشناخته
 * را نادیده می‌گیریم (ممکن است بعداً فیلدِ صفحه‌بندی اضافه شود). همه‌ی حالت‌های گِیت‌شده —
 * موجودیِ ناکافی (۴۰۲ + لینکِ شارژ در 1xai)، محدودیتِ پلن (۴۰۳)، قطعیِ زیرساخت (۵۰۳)،
 * گاردِ نرخ (۴۲۹) و «هنوز فیلتری نیست» (۲۰۰/reason=no_filters) — پیامِ صادقانه‌ی جدا دارند.
 */
import { useState } from "react";
import { Search } from "lucide-react";

import { Button, cn, toFaDigits } from "./ui";
import { IconCheck } from "./icons";

/** نشانیِ شارژِ کیف‌پولِ واحد — کارجو خودش شارژ نمی‌گیرد؛ همه‌چیز در 1xai. */
const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

/** پیامِ پیش‌فرضِ «هنوز فیلتری نیست» اگر سرور message نداد. */
const DEFAULT_NO_FILTERS =
  "هنوز فیلتری تنظیم نکرده‌اید. ابتدا دسته، شهر یا نوعِ همکاری را انتخاب و ذخیره کنید.";

/**
 * نتیجه‌ی تفسیرشده‌ی پاسخِ find-jobs — منطقِ خالصِ نگاشتِ (status × body) به یک حالتِ UI.
 * قالب‌بندیِ متن/عدد در کامپوننت انجام می‌شود؛ این‌جا فقط تصمیمِ شاخه.
 */
export type FindJobsOutcome =
  | { kind: "queued"; enqueued: number; alreadyQueued: number; skippedByCap: number }
  | { kind: "none"; alreadyQueued: number; skippedByCap: number }
  | { kind: "noFilters"; message: string }
  | { kind: "rateLimited"; retryAfterSec: number | null }
  | { kind: "insufficientBalance"; topupUrl: string }
  | { kind: "planLimited"; message: string | null }
  | { kind: "infra" }
  | { kind: "auth" }
  | { kind: "error"; message: string | null };

/** رشته‌ی غیرخالی یا null. */
function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** عددِ متناهی یا صفر (فیلدهای شمارشیِ گزارش همیشه عددِ نامنفی‌اند). */
function finiteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * پاسخِ POST /api/apply/find-jobs را به یک حالتِ UI نگاشت می‌کند (منطقِ خالص و قابلِ تست).
 *
 * فیلدهای مستند که به آن‌ها تکیه می‌شود:
 *   • موفق (۲۰۰): `enqueued`, `alreadyQueued`, `skippedByCap` (اعداد) — و در حالتِ خاصِ
 *     «بدونِ فیلتر» فیلدِ `reason === "no_filters"` به‌همراه `message` (متن).
 *   • خطاها: `error` (متن)، `retryAfterSec` (۴۲۹)، `topupUrl` (۴۰۲، در صورتِ وجود).
 * فیلدهای ناشناخته نادیده گرفته می‌شوند تا افزوده‌های آینده (مثلِ صفحه‌بندی) چیزی را نشکنند.
 */
export function interpretFindJobsResponse(status: number, body: unknown): FindJobsOutcome {
  const b: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (status === 200) {
    // پاسخِ دوستانه‌ی سرور وقتی هیچ فیلترِ هدف‌گیری‌ای ذخیره نشده.
    if (b.reason === "no_filters") {
      return { kind: "noFilters", message: nonEmptyString(b.message) ?? DEFAULT_NO_FILTERS };
    }
    const enqueued = finiteNumber(b.enqueued);
    const alreadyQueued = finiteNumber(b.alreadyQueued);
    const skippedByCap = finiteNumber(b.skippedByCap);
    if (enqueued > 0) return { kind: "queued", enqueued, alreadyQueued, skippedByCap };
    return { kind: "none", alreadyQueued, skippedByCap };
  }

  if (status === 401) return { kind: "auth" };
  if (status === 402) {
    return {
      kind: "insufficientBalance",
      topupUrl: nonEmptyString(b.topupUrl) ?? ONEXAI_TOPUP_URL,
    };
  }
  if (status === 403) return { kind: "planLimited", message: nonEmptyString(b.error) };
  if (status === 429) {
    const retryAfterSec =
      typeof b.retryAfterSec === "number" && Number.isFinite(b.retryAfterSec)
        ? b.retryAfterSec
        : null;
    return { kind: "rateLimited", retryAfterSec };
  }
  if (status === 503) return { kind: "infra" };

  // ۴۰۰/۵۰۰/هر چیزِ دیگر → خطای عمومی (با پیامِ سرور اگر بود).
  return { kind: "error", message: nonEmptyString(b.error) };
}

/* ─────────────────────────  نگاشتِ حالت → پیامِ فارسی  ───────────────────────── */

type ResultTone = "success" | "info" | "error";

interface ResultView {
  tone: ResultTone;
  /** متنِ اصلیِ پیام. */
  text: string;
  /** لینکِ شارژ (فقط در ۴۰۲) — کنارِ متن نشان داده می‌شود. */
  topupUrl?: string;
}

/** حالتِ تفسیرشده را به پیامِ صادقانه‌ی فارسی + لحن تبدیل می‌کند. */
function viewFor(outcome: FindJobsOutcome): ResultView {
  const fa = (n: number) => toFaDigits(n);
  switch (outcome.kind) {
    case "queued": {
      let text = `${fa(outcome.enqueued)} فرصتِ جدید به صفِ اپلای اضافه شد.`;
      if (outcome.alreadyQueued > 0) {
        text += ` ${fa(outcome.alreadyQueued)} مورد از قبل در صف بود.`;
      }
      if (outcome.skippedByCap > 0) {
        text += ` ${fa(outcome.skippedByCap)} مورد به‌خاطرِ سقفِ روزانه‌ی پلن اضافه نشد.`;
      }
      return { tone: "success", text };
    }
    case "none": {
      if (outcome.skippedByCap > 0) {
        return {
          tone: "info",
          text: `به سقفِ روزانه‌ی پلن رسیده‌اید؛ ${fa(
            outcome.skippedByCap,
          )} مورد اضافه نشد. برای اپلای بیشتر پلن را ارتقا دهید.`,
        };
      }
      if (outcome.alreadyQueued > 0) {
        return {
          tone: "info",
          text: "فرصتِ تازه‌ای نبود؛ همه‌ی آگهی‌های این جست‌وجو از قبل در صف بودند.",
        };
      }
      return {
        tone: "info",
        text: "فعلاً فرصتی برای این فیلترها پیدا نشد. فیلترها را بازتر کنید یا کمی بعد دوباره امتحان کنید.",
      };
    }
    case "noFilters":
      return { tone: "info", text: outcome.message };
    case "rateLimited":
      return {
        tone: "error",
        text: "درخواست‌های زیاد؛ چند لحظه صبر کنید و دوباره تلاش کنید.",
      };
    case "insufficientBalance":
      return {
        tone: "error",
        text: "موجودیِ کیف‌پولِ 1xai برای فیلترِ هوشمند کافی نیست.",
        topupUrl: outcome.topupUrl,
      };
    case "planLimited":
      return {
        tone: "error",
        text: outcome.message ?? "این قابلیت در پلنِ فعلیِ شما فعال نیست.",
      };
    case "infra":
      return { tone: "error", text: "مشکلِ موقتی؛ کمی بعد دوباره امتحان کن." };
    case "auth":
      return { tone: "error", text: "نشستِ شما منقضی شده؛ دوباره وارد شوید." };
    case "error":
      return {
        tone: "error",
        text: outcome.message ?? "جست‌وجو ناموفق بود. کمی بعد دوباره تلاش کنید.",
      };
  }
}

const TONE_BOX: Record<ResultTone, string> = {
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  info: "border border-border bg-surface/70 text-muted",
  error: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

/* ───────────────────────────────  کامپوننت  ──────────────────────────────── */

/**
 * کارتِ اقدامِ «جست‌وجوی مشاغل» — دکمه + ناحیه‌ی پیامِ نتیجه. مستقل از ذخیره است و
 * بلافاصله پس از ذخیره‌ی فیلترها قابلِ استفاده است.
 */
export function FindJobsButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<ResultView | null>(null);

  async function run() {
    if (pending) return;
    setPending(true);
    setView(null);
    try {
      const res = await fetch("/api/apply/find-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // بدنه‌ی خالی — سرور کاربر/فیلتر/مکان‌نما را خودش می‌داند.
        body: "{}",
      });
      const data: unknown = await res.json().catch(() => ({}));
      setView(viewFor(interpretFindJobsResponse(res.status, data)));
    } catch {
      setView({ tone: "error", text: "اتصال برقرار نشد. اینترنت را بررسی کنید." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-brand/30 bg-brand/[0.06] p-5 sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
            <Search className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-balance text-base font-bold">همین حالا شغل‌ها را پیدا کن</h2>
            <p className="mt-1 text-pretty text-xs leading-6 text-muted">
              با فیلترهای ذخیره‌شده‌ات جست‌وجو می‌کند و فرصت‌های تازه را به صفِ اپلای اضافه
              می‌کند — بدونِ نیاز به هوش مصنوعی.
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={run}
          disabled={pending}
          className="shrink-0"
          aria-busy={pending}
        >
          {pending ? (
            "در حال جست‌وجو…"
          ) : (
            <>
              <Search className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              جست‌وجوی مشاغل
            </>
          )}
        </Button>
      </div>

      {view ? (
        <p
          role={view.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-4 text-pretty rounded-xl px-4 py-3 text-sm leading-6",
            TONE_BOX[view.tone],
          )}
        >
          {view.tone === "success" ? (
            <IconCheck className="me-1.5 inline h-4 w-4 align-[-2px]" />
          ) : null}
          {view.text}
          {view.topupUrl ? (
            <>
              {" "}
              <a
                href={view.topupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold underline underline-offset-4"
              >
                شارژِ کیف‌پول در 1xai ↗
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
