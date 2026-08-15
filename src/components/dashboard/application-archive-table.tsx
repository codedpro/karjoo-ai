"use client";

/**
 * جدولِ بایگانیِ ارسال‌ها (client, RTL) — «چه چیزی، برای چه کسی، با کدام رزومه».
 *
 * برای وقتی کارفرما تماس می‌گیرد: در یک نگاه شرکت/عنوان/تاریخ را ببین، شرحِ کاملِ آگهی
 * (JD) را در مودال باز کن، و **همان رزومه‌ای را که ارسال شده** در تبِ تازه ببین یا چاپ کن
 * (نه رزومه‌ی امروز — همان نسخه‌ی ارسال‌شده).
 *
 * دو تصمیمِ ظاهریِ مهم:
 *   • فقط توکن‌های طراحی (border/card/surface/brand). قبلاً رنگ‌های خام (`white/10`,
 *     `#FFB020`) بود و در تمِ روشن جدول عملاً نامرئی می‌شد.
 *   • قاب `TableFrame` است: اسکرولِ افقی *درونِ* کارت مهار می‌شود و ستون‌های کم‌اهمیت‌تر
 *     (مسیرِ ارسال) در نمایشگرِ باریک پنهان‌اند، پس دیگر `min-w` کور به همه تحمیل نمی‌شود.
 *
 * داده از سرور می‌آید (RSC) و این کامپوننت فقط تعامل (مودال/جست‌وجو) را می‌سازد.
 */
import { useEffect, useMemo, useState } from "react";

import { Badge, TableFrame, toFaDigits } from "@/components/dashboard/ui";
import { IconClose, IconSearch } from "@/components/dashboard/icons";

export interface ArchiveRow {
  id: string;
  status: string;
  channel: string | null;
  matchScore: number | null;
  reason: string | null;
  submittedAt: string | null;
  createdAt: string;
  listing: {
    title: string;
    company: string | null;
    city: string | null;
    url: string;
    board: string;
    description: string | null;
  };
  resume: { id: string; title: string | null } | null;
}

const STATUS_LABEL: Record<string, { fa: string; tone: "green" | "amber" | "rose" | "muted" }> = {
  submitted: { fa: "ارسال شد", tone: "green" },
  draft: { fa: "پیش‌نویس", tone: "muted" },
  skipped: { fa: "ارسال نشد", tone: "amber" },
  failed: { fa: "ناموفق", tone: "rose" },
};

const CHANNEL_LABEL: Record<string, string> = {
  worker: "سرور (۲۴/۷)",
  extension: "افزونه",
};

/** تاریخِ کوتاهِ فارسی. */
function faDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

/** کلاسِ مشترکِ دکمه‌های کوچکِ درونِ ردیف (ثانویه) — تماماً توکنی. */
const ROW_BUTTON =
  "focus-ring inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:border-brand/50 hover:text-brand";

export function ApplicationArchiveTable({ rows }: { rows: ArchiveRow[] }) {
  const [query, setQuery] = useState("");
  const [openJd, setOpenJd] = useState<ArchiveRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.listing.title, r.listing.company, r.listing.city].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  // بستنِ مودال با Esc — انتظارِ پایه‌ی هر دیالوگ؛ نبودش کاربر را گیر می‌انداخت.
  useEffect(() => {
    if (!openJd) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenJd(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openJd]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative w-full max-w-xs sm:w-64">
          <span className="sr-only">جست‌وجو در عنوانِ شغل یا نامِ شرکت</span>
          <IconSearch
            className="pointer-events-none absolute inset-y-0 inset-s-3 my-auto h-4 w-4 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجو در عنوان یا شرکت…"
            className="focus-ring w-full rounded-xl border border-border bg-card py-2 pe-3 ps-9 text-sm placeholder:text-muted/70"
          />
        </label>
        <span className="text-xs text-muted">
          {toFaDigits(filtered.length)} از {toFaDigits(rows.length)} ارسال
        </span>
      </div>

      <TableFrame minWidth="34rem">
        <table className="w-full text-right text-sm">
          <thead className="border-b border-border bg-surface/60 text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">شغل / شرکت</th>
              <th className="whitespace-nowrap px-4 py-3 font-medium">تاریخ</th>
              <th className="px-4 py-3 font-medium">وضعیت</th>
              {/* مسیرِ ارسال کنجکاوی است نه تصمیم — در نمایشگرِ باریک جا نمی‌گیرد. */}
              <th className="hidden px-4 py-3 font-medium lg:table-cell">مسیرِ ارسال</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">شرحِ شغل</th>
              <th className="px-4 py-3 font-medium">رزومه‌ی ارسال‌شده</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((r) => {
              const st = STATUS_LABEL[r.status] ?? { fa: r.status, tone: "muted" as const };
              return (
                <tr key={r.id} className="align-top transition-colors hover:bg-foreground/2">
                  <td className="px-4 py-3">
                    <a
                      href={r.listing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring rounded-sm font-medium transition-colors hover:text-brand"
                    >
                      {r.listing.title}
                    </a>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.listing.company ?? "—"}
                      {r.listing.city ? ` · ${r.listing.city}` : ""}
                    </div>
                  </td>
                  <td className="ltr-nums whitespace-nowrap px-4 py-3 text-xs text-muted">
                    {toFaDigits(faDate(r.submittedAt ?? r.createdAt))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={st.tone}>{st.fa}</Badge>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">
                    {r.channel ? (CHANNEL_LABEL[r.channel] ?? r.channel) : "—"}
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    {r.listing.description ? (
                      <button type="button" onClick={() => setOpenJd(r)} className={ROW_BUTTON}>
                        مشاهده
                      </button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.resume ? (
                      <a
                        href={`/api/applications/${r.id}/resume`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-flex items-center whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground transition hover:brightness-110"
                      >
                        دیدنِ رزومه
                      </a>
                    ) : (
                      <span className="text-xs text-muted">رزومه‌ی پروفایل</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>

      {openJd && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`شرحِ شغل — ${openJd.listing.title}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => setOpenJd(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div className="min-w-0">
                <h2 className="text-balance text-lg font-bold">{openJd.listing.title}</h2>
                <p className="mt-1 text-xs text-muted">
                  {openJd.listing.company ?? "—"}
                  {openJd.listing.city ? ` · ${openJd.listing.city}` : ""} ·{" "}
                  {toFaDigits(faDate(openJd.submittedAt ?? openJd.createdAt))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenJd(null)}
                aria-label="بستن"
                className="focus-ring shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              <p className="whitespace-pre-wrap text-pretty text-sm leading-7 text-muted" dir="auto">
                {openJd.listing.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-border p-4">
              <a
                href={openJd.listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring rounded-xl border border-border px-4 py-2 text-sm transition-colors hover:border-brand/50 hover:text-brand"
              >
                آگهی در سایت
              </a>
              {openJd.resume && (
                <a
                  href={`/api/applications/${openJd.id}/resume`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring rounded-xl bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition hover:brightness-110"
                >
                  رزومه‌ای که فرستادیم
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
