"use client";

/**
 * جدولِ بایگانیِ اپلای (client, RTL) — «چه چیزی، برای چه کسی، با کدام رزومه».
 *
 * برای وقتی کارفرما تماس می‌گیرد: در یک نگاه شرکت/عنوان/تاریخ را ببین، شرحِ کاملِ آگهی
 * (JD) را در مودال باز کن، و **همان رزومه‌ای را که ارسال شده** در تبِ تازه ببین یا چاپ کن
 * (نه رزومه‌ی امروز — همان نسخه‌ی ارسال‌شده).
 *
 * داده از سرور می‌آید (RSC) و این کامپوننت فقط تعامل (مودال/جست‌وجو) را می‌سازد.
 */
import { useMemo, useState } from "react";

import { Badge, cn, toFaDigits } from "@/components/dashboard/ui";

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
  skipped: { fa: "رد شد", tone: "amber" },
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جست‌وجو در عنوان یا شرکت…"
          className="w-full max-w-xs rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#FFB020]/60 sm:w-64"
        />
        <span className="text-xs text-muted">
          {toFaDigits(filtered.length)} از {toFaDigits(rows.length)} اپلای
        </span>
      </div>

      {/* جدول روی موبایل افقی اسکرول می‌شود؛ خودِ صفحه هرگز افقی اسکرول نمی‌کند. */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[760px] text-right text-sm">
          <thead className="bg-white/5 text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">شغل / شرکت</th>
              <th className="px-4 py-3 font-medium">تاریخ</th>
              <th className="px-4 py-3 font-medium">وضعیت</th>
              <th className="px-4 py-3 font-medium">مسیر</th>
              <th className="px-4 py-3 font-medium">شرحِ شغل</th>
              <th className="px-4 py-3 font-medium">رزومه‌ی ارسال‌شده</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const st = STATUS_LABEL[r.status] ?? { fa: r.status, tone: "muted" as const };
              return (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="px-4 py-3">
                    <a
                      href={r.listing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-[#FFB020]"
                    >
                      {r.listing.title}
                    </a>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.listing.company ?? "—"}
                      {r.listing.city ? ` · ${r.listing.city}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {faDate(r.submittedAt ?? r.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={st.tone}>{st.fa}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {r.channel ? (CHANNEL_LABEL[r.channel] ?? r.channel) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.listing.description ? (
                      <button
                        type="button"
                        onClick={() => setOpenJd(r)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:border-[#FFB020]/60 hover:text-[#FFB020]"
                      >
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
                        className="rounded-lg bg-[#FFB020] px-3 py-1.5 text-xs font-bold text-[#1a1d21] hover:brightness-110"
                      >
                        دیدن رزومه
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
      </div>

      {openJd && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`شرحِ شغل — ${openJd.listing.title}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpenJd(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#12151a] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div>
                <h2 className="text-lg font-bold">{openJd.listing.title}</h2>
                <p className="mt-1 text-xs text-muted">
                  {openJd.listing.company ?? "—"}
                  {openJd.listing.city ? ` · ${openJd.listing.city}` : ""} ·{" "}
                  {faDate(openJd.submittedAt ?? openJd.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenJd(null)}
                aria-label="بستن"
                className="rounded-lg border border-white/10 px-2.5 py-1 text-sm hover:border-[#FFB020]/60"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-5">
              <p className={cn("whitespace-pre-wrap text-sm leading-7 text-white/85")} dir="auto">
                {openJd.listing.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-white/10 p-4">
              <a
                href={openJd.listing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:border-[#FFB020]/60"
              >
                آگهی در سایت
              </a>
              {openJd.resume && (
                <a
                  href={`/api/applications/${openJd.id}/resume`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-[#FFB020] px-4 py-2 text-sm font-bold text-[#1a1d21] hover:brightness-110"
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
