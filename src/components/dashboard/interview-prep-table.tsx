"use client";

/**
 * جدولِ «وضعیتِ اپلای‌ها» (client — فیلتر/جست‌وجو/تلاشِ دوباره در خودِ مرورگر انجام می‌شود).
 *
 * سه تصمیمِ اصلیِ این بازنویسی:
 *   ۱) قابِ جدول `TableFrame` است، نه یک `min-w-[1100px]` که *همیشه* افقی اسکرول می‌شد.
 *      ستون‌های کم‌اهمیت‌تر (زمان/تلاش/توضیح) زیرِ md و xl پنهان می‌شوند و همان توضیح
 *      روی صفحه‌های کوچک زیرِ عنوانِ شغل تکرار می‌شود؛ پس هیچ اطلاعاتی گم نمی‌شود.
 *   ۲) ردیفِ شش‌تاییِ آمار حذف شد و شمارها روی خودِ چیپ‌های فیلتر نشستند — یک ردیفِ کمتر،
 *      و هر عدد دقیقاً کنارِ فیلترِ خودش.
 *   ۳) برچسبِ هر وضعیت فارسیِ ساده است و یک جمله‌ی «یعنی چه/چه کار کنم» همراه دارد
 *      (به‌جای «در انتظار retry» و «متوقف»). هیچ واژه‌ی لاتینی در متنِ کاربر نمانده.
 *
 * «هیچ ردیفی نداری» با «فیلترت چیزی پیدا نکرد» یکی نیست: اولی حالتِ خالیِ واقعیِ کاربرِ
 * تازه‌وارد است و باید راهِ ادامه بدهد (لینک به اپلای خودکار)؛ دومی فقط پیشنهادِ
 * پاک‌کردنِ فیلتر است.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { IconDoc, IconRefresh, IconSend } from "@/components/dashboard/icons";
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  TableFrame,
  cn,
  toFaDigits,
} from "@/components/dashboard/ui";
import type {
  InterviewPrepData,
  InterviewPrepRow,
  InterviewPrepStatus,
} from "@/lib/apply/interview-prep";

type StatusTone = "green" | "amber" | "rose" | "muted" | "brand" | "accent";

/**
 * برچسبِ فارسیِ هر وضعیت + یک جمله‌ی کوتاه که می‌گوید *چه اتفاقی افتاده* و اگر کاری از
 * کاربر برمی‌آید چیست. `note` زیرِ نشانِ وضعیت در همان ردیف دیده می‌شود.
 */
const STATUS_META: Record<
  InterviewPrepStatus | "all",
  { label: string; tone: StatusTone; note: string }
> = {
  all: { label: "همه", tone: "muted", note: "" },
  queued: {
    label: "در نوبتِ ارسال",
    tone: "accent",
    note: "به‌زودی خودکار فرستاده می‌شود.",
  },
  applying: {
    label: "در حالِ ارسال",
    tone: "brand",
    note: "همین حالا در حالِ پرکردنِ فرمِ کارفرماست.",
  },
  submitted: {
    label: "ارسال شد",
    tone: "green",
    note: "درخواستت به کارفرما رسید.",
  },
  failed: {
    label: "ارسال نشد",
    tone: "rose",
    note: "می‌توانی دوباره تلاش کنی.",
  },
  skipped: {
    label: "صرف‌نظر شد",
    tone: "amber",
    note: "شرایطِ این آگهی با پروفایلت نمی‌خواند.",
  },
  dead: {
    label: "بعد از چند تلاش متوقف شد",
    tone: "rose",
    note: "بهتر است این یکی را خودت در سایت بفرستی.",
  },
  draft: {
    label: "آماده‌ی ارسالِ دوباره",
    tone: "muted",
    note: "در نوبتِ تلاشِ بعدی است.",
  },
};

const FILTERS: Array<InterviewPrepStatus | "all"> = [
  "all",
  "queued",
  "applying",
  "submitted",
  "failed",
  "skipped",
  "dead",
];

/** شمارِ هر چیپِ فیلتر از خلاصه‌ی سرور (چیپِ «همه» = کلِ ردیف‌ها). */
function filterCount(
  summary: InterviewPrepData["summary"],
  key: InterviewPrepStatus | "all",
): number {
  if (key === "all") return summary.total;
  if (key === "draft") return 0;
  return summary[key];
}

/** از کجا فرستاده شده — بدونِ واژه‌ی داخلی («worker»/«extension»). */
function channelLabel(channel: InterviewPrepRow["channel"]): string | null {
  if (channel === "worker") return "از سرورهای کارجو";
  if (channel === "extension") return "از مرورگرِ خودت";
  return null;
}

function faDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function rowText(row: InterviewPrepRow): string {
  return [
    row.listing.title,
    row.listing.company,
    row.listing.city,
    row.listing.board,
    row.reason,
    row.lastError,
    row.listing.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function InterviewPrepTable({ data }: { data: InterviewPrepData }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<InterviewPrepStatus | "all">("all");
  const [openJd, setOpenJd] = useState<InterviewPrepRow | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!q) return true;
      return rowText(row).includes(q);
    });
  }, [data.rows, query, status]);

  async function retry(row: InterviewPrepRow) {
    if (!row.applicationId) return;
    setRetrying(row.applicationId);
    setNotice(null);
    try {
      const res = await fetch(`/api/applications/${row.applicationId}/retry`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(body.error ?? "تلاشِ دوباره انجام نشد.");
        return;
      }
      setNotice("دوباره در نوبتِ ارسال قرار گرفت.");
      startTransition(() => router.refresh());
    } finally {
      setRetrying(null);
    }
  }

  // کاربرِ تازه‌وارد اصلاً ردیفی ندارد — این «چیزی پیدا نشد» نیست، «هنوز شروع نشده» است.
  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={<IconSend />}
        title="هنوز هیچ درخواستی فرستاده نشده"
        body="وقتی اپلای خودکار را تنظیم کنی، هر آگهی که برایت فرستاده می‌شود همین‌جا با نتیجه‌اش می‌آید."
        action={
          <ButtonLink href="/dashboard/auto-apply">تنظیمِ اپلای خودکار</ButtonLink>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* نوارِ فیلتر: چیپ‌های وضعیت (با شمار) + جست‌وجو */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="فیلترِ وضعیت">
            {FILTERS.map((item) => {
              const active = status === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  aria-pressed={active}
                  className={cn(
                    "focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors",
                    active
                      ? "border-brand/50 bg-brand/10 text-brand"
                      : "border-border text-muted hover:text-foreground",
                  )}
                >
                  {STATUS_META[item].label}
                  <span className="ltr-nums font-normal opacity-70">
                    {toFaDigits(filterCount(data.summary, item))}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="lg:w-full lg:max-w-sm">
            <label htmlFor="apply-status-search" className="sr-only">
              جست‌وجو در فهرست
            </label>
            <input
              id="apply-status-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="جست‌وجو در عنوانِ شغل، شرکت یا متنِ آگهی"
              className="focus-ring w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            نمایشِ {toFaDigits(filtered.length)} از {toFaDigits(data.rows.length)}
          </span>
          <span>آخرین به‌روزرسانی: {faDate(data.updatedAt)}</span>
          {notice ? (
            <span role="status" className="font-bold text-brand">
              {notice}
            </span>
          ) : null}
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState
          title="با این فیلتر چیزی پیدا نشد"
          body="عبارتِ جست‌وجو را کوتاه‌تر کن یا روی «همه» بزن."
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStatus("all");
                setQuery("");
              }}
            >
              نمایشِ همه
            </Button>
          }
        />
      ) : (
        <TableFrame minWidth="38rem">
          <table className="w-full text-right text-sm">
            <thead className="border-b border-border bg-surface/60 text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">شغل</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">زمان</th>
                <th className="hidden px-4 py-3 font-medium xl:table-cell">
                  تعدادِ تلاش
                </th>
                <th className="hidden px-4 py-3 font-medium xl:table-cell">توضیح</th>
                <th className="px-4 py-3 font-medium">اقدام</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const meta = STATUS_META[row.status];
                const channel = channelLabel(row.channel);
                const detail = row.lastError || row.reason;
                return (
                  <tr
                    key={`${row.matchId}-${row.taskId ?? row.applicationId}`}
                    className="border-b border-border/60 align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      <a
                        href={row.listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring line-clamp-2 rounded font-bold hover:text-brand"
                      >
                        {row.listing.title}
                      </a>
                      <p className="mt-1 truncate text-xs text-muted">
                        {row.listing.company ?? "—"}
                        {row.listing.city ? ` · ${row.listing.city}` : ""}
                      </p>
                      {/* توضیح روی صفحه‌های باریک این‌جا می‌آید تا ستونِ جدا لازم نشود. */}
                      {detail ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted xl:hidden">
                          {detail}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <p className="mt-1.5 text-pretty text-xs leading-5 text-muted">
                        {meta.note}
                      </p>
                      {channel ? (
                        <p className="mt-0.5 text-xs text-muted/80">{channel}</p>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 text-xs text-muted md:table-cell">
                      {faDate(row.happenedAt)}
                    </td>
                    <td className="ltr-nums hidden px-4 py-3 text-xs text-muted xl:table-cell">
                      {toFaDigits(row.attempts)}
                    </td>
                    <td className="hidden px-4 py-3 text-xs leading-6 text-muted xl:table-cell">
                      <span className="line-clamp-3">{detail || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.listing.description ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setOpenJd(row)}
                          >
                            متنِ آگهی
                          </Button>
                        ) : null}
                        {row.applicationId && row.hasResume ? (
                          <a
                            href={`/api/applications/${row.applicationId}/resume`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-foreground hover:brightness-110"
                          >
                            <IconDoc className="h-3.5 w-3.5" />
                            رزومه‌ی ارسالی
                          </a>
                        ) : null}
                        {row.status === "failed" && row.applicationId ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={retrying === row.applicationId || isPending}
                            onClick={() => retry(row)}
                          >
                            <IconRefresh className="h-3.5 w-3.5" />
                            تلاشِ دوباره
                          </Button>
                        ) : null}
                        {!row.listing.description &&
                        !(row.applicationId && row.hasResume) &&
                        !(row.status === "failed" && row.applicationId) ? (
                          <span className="text-xs text-muted">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      )}

      {openJd ? <JdModal row={openJd} onClose={() => setOpenJd(null)} /> : null}
    </div>
  );
}

/* ─────────────────────────────  متنِ کاملِ آگهی  ───────────────────────────── */

/**
 * پنجره‌ی متنِ آگهی. با Escape و کلیک روی پس‌زمینه بسته می‌شود (پس‌زمینه یک دکمه‌ی
 * واقعی با برچسبِ دسترس‌پذیر است، نه یک div کلیک‌خور).
 */
function JdModal({
  row,
  onClose,
}: {
  row: InterviewPrepRow;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="بستنِ متنِ آگهی"
        onClick={onClose}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="jd-modal-title"
        className="relative max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <h2 id="jd-modal-title" className="line-clamp-2 text-lg font-black">
              {row.listing.title}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {row.listing.company ?? "—"}
              {row.listing.city ? ` · ${row.listing.city}` : ""} ·{" "}
              {faDate(row.happenedAt)}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            بستن
          </Button>
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-5">
          <p
            className="whitespace-pre-wrap text-sm leading-8 text-foreground/85"
            dir="auto"
          >
            {row.listing.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-border p-4">
          <a
            href={row.listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring rounded-full border border-border px-4 py-2 text-sm hover:border-brand/60"
          >
            دیدنِ آگهی در سایت
          </a>
          {row.applicationId && row.hasResume ? (
            <a
              href={`/api/applications/${row.applicationId}/resume`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground hover:brightness-110"
            >
              رزومه‌ی ارسالی
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
