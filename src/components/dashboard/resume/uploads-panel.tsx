"use client";

/**
 * پنلِ آپلود + مدیریتِ فایل‌های رزومه (Track C, client).
 *
 * سه کارِ اصلی:
 *   ۱) آپلودِ PDF (drag/drop یا انتخاب) — POST /api/resume/upload — *رایگان*؛ همیشه موفق
 *      و پایدار (فایل روی دیسک + رکورد در DB). خطای استخراجِ متن فایل را باطل نمی‌کند.
 *   ۲) فهرستِ پایدارِ فایل‌ها: نام/اندازه/تاریخ/دانلود + دو کنشِ روشن به‌ازای هر فایل:
 *        • «استخراج با هوش مصنوعی» (POST /api/resume/parse) — *پولی* (نشانِ هزینه).
 *        • «استفاده به‌عنوان رزومه‌ی اصلی» (POST /api/resume/primary) — *رایگان*، بدونِ AI.
 *      + حذف (DELETE /api/resume/file) با تأیید.
 *   ۳) UXِ ۴۰۲: اگر استخراجِ پولی موجودی نداشت، به‌جای «درخواست ناموفق»، پنلِ روشنِ
 *      «شارژِ کیف‌پول لازم است» + تخمینِ هزینه + دکمه‌ی شارژ (TopupPrompt).
 *
 * تفکیکِ رایگان/پولی *پررنگ* است: آپلود و «رزومه‌ی اصلی» نشانِ «رایگان»؛ استخراج نشانِ هزینه.
 * وقتی هوش مصنوعی فیلدها را استخراج کرد، از طریقِ onParsed به فرمِ پروفایل داده می‌شود.
 *
 * کارتِ آپلود `id="resume-files"` دارد: حالتِ خالیِ صفحه‌ی «رزومه و پروفایل» تنها فراخوانش
 * را به همین‌جا لنگر می‌زند، پس این شناسه بخشی از قرارداد است و نباید بی‌جایگزین حذف شود.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  IconDoc,
  IconDownload,
  IconSparkle,
  IconStar,
  IconTrash,
  IconUpload,
} from "../icons";
import { Badge, Card, cn, toFaDigits } from "../ui";
import { CostHint, FreeBadge, TopupPrompt } from "../paid-action";
import { AiMaintenanceBanner } from "../ai-maintenance-banner";
import {
  readPaidActionResponse,
  type CostEstimate,
  type TopupNeeded,
} from "@/lib/billing/ui";
import {
  detectMaintenance,
  maintenanceMessage,
  type AiStatus,
} from "@/lib/billing/guardrail-ui";
import type { ApiFullProfile } from "@/lib/resume/profile-view";
import type { ClientResumeFile } from "./profile-types";

/** اندازه‌ی بایت را با ارقامِ فارسی قالب می‌کند. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${toFaDigits(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${toFaDigits(Math.round(kb))} کیلوبایت`;
  return `${toFaDigits((kb / 1024).toFixed(1))} مگابایت`;
}

/** تاریخِ ساخت را به تاریخِ شمسیِ کوتاه قالب می‌کند (fail-safe: در خطا رشته‌ی خام). */
function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function UploadsPanel({
  files,
  parseCostEstimate,
  balanceToman,
  onParsed,
  onNotice,
}: {
  files: ClientResumeFile[];
  parseCostEstimate: CostEstimate | null;
  balanceToman?: number;
  /** وقتی استخراجِ AI موفق شد، پروفایلِ به‌روز را به والد (فرم) می‌دهد. */
  onParsed: (profile: ApiFullProfile) => void;
  /** پیامِ موفقیت/راهنما برای نمایش در والد (اختیاری). */
  onNotice?: (msg: string) => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<
    null | { kind: "upload" } | { kind: "parse" | "primary" | "delete"; id: string }
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [topup, setTopup] = useState<TopupNeeded | null>(null);
  const [aiMaintenance, setAiMaintenance] = useState(false);

  const anyBusy = busy !== null;

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setTopup(null);
      setBusy({ kind: "upload" });
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/resume/upload", { method: "POST", body: form });
        const data: {
          error?: string;
          resumeFile?: { id: string; hasText: boolean };
        } = await res.json().catch(() => ({}));

        if (!res.ok || !data.resumeFile) {
          setError(data.error ?? "آپلودِ فایل ناموفق بود.");
          return;
        }
        onNotice?.(
          data.resumeFile.hasText
            ? "فایل آپلود و متنِ آن استخراج شد. حالا می‌توانید «استخراج با هوش مصنوعی» را بزنید یا آن را «رزومه‌ی اصلی» کنید."
            : "فایل آپلود شد ولی متنی از آن استخراج نشد (احتمالاً PDF اسکن‌شده است). می‌توانید آن را «رزومه‌ی اصلی» کنید یا فیلدها را دستی وارد کنید.",
        );
        router.refresh();
      } catch {
        setError("اتصال به سرور برقرار نشد.");
      } finally {
        setBusy(null);
      }
    },
    [onNotice, router],
  );

  async function handleParse(id: string) {
    setError(null);
    setTopup(null);
    setBusy({ kind: "parse", id });
    try {
      const res = await fetch("/api/resume/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeFileId: id }),
      });

      // حالتِ نگه‌داریِ هوش مصنوعی (۵۰۳ + code=ai_maintenance).
      const maintBody: unknown = await res.clone().json().catch(() => null);
      const maint = detectMaintenance(res.status, maintBody);
      if (maint) {
        setAiMaintenance(true);
        setError(maintenanceMessage(maint.reason));
        return;
      }

      // پولی: ۴۰۲ → پرامپتِ شارژ (نه خطای عمومی).
      const outcome = await readPaidActionResponse<{ profile?: ApiFullProfile }>(res);
      if (outcome.topup) {
        setTopup(outcome.topup);
        return;
      }
      if (!outcome.ok || !outcome.data?.profile) {
        setError(outcome.error ?? "استخراجِ هوش مصنوعی ناموفق بود.");
        return;
      }

      onParsed(outcome.data.profile);
      onNotice?.(
        "فیلدها با هوش مصنوعی استخراج و در فرمِ پروفایل ریخته شدند. بررسی‌شان کنید و «ذخیره‌ی پروفایل» را بزنید.",
      );
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSetPrimary(id: string) {
    setError(null);
    setBusy({ kind: "primary", id });
    try {
      const res = await fetch("/api/resume/primary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeFileId: id }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "تعیینِ رزومه‌ی اصلی ناموفق بود.");
        return;
      }
      onNotice?.("این فایل به‌عنوانِ رزومه‌ی اصلیِ شما تنظیم شد.");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string, fileName: string) {
    if (
      !window.confirm(
        `«${fileName}» حذف شود؟ این کار برگشت‌ناپذیر است.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusy({ kind: "delete", id });
    try {
      const res = await fetch("/api/resume/file", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeFileId: id }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "حذفِ فایل ناموفق بود.");
        return;
      }
      onNotice?.("فایل حذف شد.");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (anyBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="text-pretty rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-600 dark:text-rose-400"
        >
          {error}
        </div>
      ) : null}

      <AiMaintenanceBanner onStatus={(s: AiStatus) => setAiMaintenance(s.maintenance)} />

      {topup ? (
        <TopupPrompt
          topup={topup}
          balanceToman={balanceToman}
          topupHref="/dashboard/billing"
          onDismiss={() => setTopup(null)}
        />
      ) : null}

      {/* ── ناحیه‌ی آپلود (drag/drop) — مقصدِ لنگرِ حالتِ خالیِ صفحه ── */}
      {/* لنگر روی یک wrapper است، نه روی Card: پرایمیتیوِ مشترک پراپِ id نمی‌گیرد. */}
      <div id="resume-files" className="scroll-mt-24">
        <Card padded>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2.5 text-balance text-base font-bold">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&>svg]:h-5 [&>svg]:w-5"
                aria-hidden
              >
                <IconUpload />
              </span>
              آپلودِ رزومه (PDF)
            </h3>
            <FreeBadge />
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!anyBusy) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              "mt-4 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver ? "border-brand bg-brand/5" : "border-border bg-surface/50",
            )}
          >
            <span
              className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand [&>svg]:h-6 [&>svg]:w-6"
              aria-hidden
            >
              <IconUpload />
            </span>
            <p className="text-pretty text-sm leading-6 text-muted">
              فایلِ PDF را اینجا رها کنید یا از دکمه‌ی زیر انتخاب کنید (حداکثر ۵ مگابایت).
              <br />
              آپلود و استخراجِ متن همیشه رایگان است.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={anyBusy}
              className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand hover:text-foreground active:translate-y-px disabled:pointer-events-none disabled:opacity-60"
            >
              <IconUpload className="h-4 w-4" />
              {busy?.kind === "upload" ? "در حال آپلود…" : "انتخابِ فایلِ PDF"}
            </button>
          </div>
        </Card>
      </div>

      {/* ── فهرستِ فایل‌ها ── */}
      <Card padded>
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&>svg]:h-5 [&>svg]:w-5"
            aria-hidden
          >
            <IconDoc />
          </span>
          <div className="min-w-0">
            <h3 className="text-balance text-base font-bold leading-tight">
              فایل‌های آپلودشده
            </h3>
            <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
              برای هر فایل: استخراجِ هوش مصنوعی (پولی) یا استفاده به‌عنوانِ رزومه‌ی اصلی (رایگان).
            </p>
          </div>
        </div>

        {files.length === 0 ? (
          <p className="mt-5 text-pretty rounded-xl border border-dashed border-border bg-surface/60 px-4 py-6 text-center text-xs leading-6 text-muted">
            هنوز فایلی آپلود نشده است.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {files.map((f) => {
              const isThisBusy =
                busy !== null && "id" in busy && busy.id === f.id;
              return (
                <li
                  key={f.id}
                  className={cn(
                    "rounded-2xl border bg-surface/40 p-4",
                    f.isPrimary ? "border-brand/40 ring-1 ring-inset ring-brand/15" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="truncate text-sm font-semibold"
                          title={f.fileName}
                        >
                          {f.fileName}
                        </span>
                        {f.isPrimary ? (
                          <Badge tone="brand">
                            <IconStar className="h-3 w-3" />
                            رزومه‌ی اصلی
                          </Badge>
                        ) : null}
                        {f.isParsed ? <Badge tone="green">پردازش‌شده</Badge> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="ltr-nums whitespace-nowrap">
                          {formatBytes(f.byteSize)}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="whitespace-nowrap">{formatDate(f.createdAt)}</span>
                        <span aria-hidden>·</span>
                        <span className="whitespace-nowrap">
                          {f.hasText ? "متن استخراج‌شده" : "بدون متن"}
                        </span>
                      </div>
                    </div>

                    {/* دانلود (رایگان) */}
                    <a
                      href={`/api/resume/download?id=${encodeURIComponent(f.id)}`}
                      className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand active:translate-y-px"
                      title="دانلودِ فایل"
                    >
                      <IconDownload className="h-3.5 w-3.5" />
                      دانلود
                    </a>
                  </div>

                  {/* کنش‌های اصلی — تفکیکِ پولی/رایگان روشن. */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                    {/* پولی: استخراج با هوش مصنوعی */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleParse(f.id)}
                        disabled={anyBusy || !f.hasText || aiMaintenance}
                        title={
                          !f.hasText
                            ? "این فایل متنِ استخراج‌شده ندارد؛ نمی‌توان با هوش مصنوعی پردازش کرد."
                            : aiMaintenance
                              ? "سرویسِ هوش مصنوعی موقتاً در دسترس نیست."
                              : undefined
                        }
                        className="focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground shadow-xs transition-[transform,opacity] hover:-translate-y-0.5 hover:brightness-110 active:translate-y-px disabled:pointer-events-none disabled:opacity-55"
                      >
                        <IconSparkle className="h-3.5 w-3.5" />
                        {isThisBusy && busy?.kind === "parse"
                          ? "در حال استخراج…"
                          : "استخراج با هوش مصنوعی"}
                      </button>
                      <CostHint estimate={parseCostEstimate} />
                    </div>

                    {/* رایگان: رزومه‌ی اصلی */}
                    <button
                      type="button"
                      onClick={() => void handleSetPrimary(f.id)}
                      disabled={anyBusy || f.isPrimary}
                      title={f.isPrimary ? "این فایل هم‌اکنون رزومه‌ی اصلیِ شماست." : undefined}
                      className="focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-4 py-2 text-xs font-medium transition-colors hover:border-brand active:translate-y-px disabled:pointer-events-none disabled:opacity-55"
                    >
                      <IconStar className="h-3.5 w-3.5" />
                      {isThisBusy && busy?.kind === "primary"
                        ? "در حال تنظیم…"
                        : f.isPrimary
                          ? "رزومه‌ی اصلی"
                          : "استفاده به‌عنوان رزومه‌ی اصلی"}
                      <FreeTag />
                    </button>

                    {/* حذف */}
                    <button
                      type="button"
                      onClick={() => void handleDelete(f.id, f.fileName)}
                      disabled={anyBusy}
                      className="focus-ring me-0 ms-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 active:translate-y-px disabled:pointer-events-none disabled:opacity-55 dark:text-rose-400"
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                      {isThisBusy && busy?.kind === "delete" ? "در حال حذف…" : "حذف"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** نشانِ ریزِ «رایگان» درونِ دکمه (متمایز از FreeBadge بزرگ‌تر). */
function FreeTag() {
  return (
    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
      رایگان
    </span>
  );
}
