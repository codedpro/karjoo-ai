"use client";

/**
 * «مرکز اپلای» — نمای زنده‌ی خانه‌ی داشبورد (client، چون هر چند ثانیه خودش را تازه می‌کند).
 *
 * سه ستون به سه سؤالِ کاربر جواب می‌دهند: همین حالا چه چیزی در حالِ ارسال است؟ بعدی‌ها
 * کدام‌اند؟ نتیجه‌ی تازه‌ها چه شد؟ شمارِ هر ستون روی خودِ سرستونِ ستون است.
 *
 * تصمیمِ محتوایی: ردیفِ پنج‌تاییِ عددها از این کارت برداشته شد؛ همان عددها یک بار بالای
 * صفحه‌ی خانه (کارت‌های آمار) می‌آیند و تکرارشان این کارت را شلوغ می‌کرد. این‌جا فقط
 * «چه چیزی در جریان است» می‌ماند.
 *
 * داده‌ی اولیه از RSC می‌آید (`initialData`) تا اولین رنگ‌آمیزی بدونِ fetch باشد؛ بعد هر
 * ۳٫۵ ثانیه در پس‌زمینه (بی‌سروصدا، بدونِ اسپینر) از /api/apply/live تازه می‌شود.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { LiveApplyOverview, LiveApplyResult, LiveApplyJob } from "@/lib/apply/live-overview";

import { IconDoc, IconRefresh, IconWarn } from "./icons";
import { Badge, Button, Card, EmptyState, Skeleton, cn, toFaDigits } from "./ui";

interface LiveApplyPanelProps {
  initialData: LiveApplyOverview;
}

const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "rose" | "muted" }> = {
  submitted: { label: "ارسال شد", tone: "green" },
  draft: { label: "پیش‌نویس", tone: "muted" },
  skipped: { label: "ارسال نشد", tone: "amber" },
  failed: { label: "ناموفق", tone: "rose" },
};

function faDateTime(iso: string | null): string {
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

function elapsed(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "کمتر از ۱ دقیقه";
  if (mins < 60) return `${toFaDigits(mins)} دقیقه`;
  return `${toFaDigits(Math.floor(mins / 60))} ساعت`;
}

export function LiveApplyPanel({ initialData }: LiveApplyPanelProps) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/apply/live?queueLimit=40&recentLimit=30", {
        cache: "no-store",
      });
      const next = (await res.json().catch(() => null)) as
        | (Partial<LiveApplyOverview> & { error?: string })
        | null;
      if (!res.ok || !next || next.error || !next.execution || !next.counts || !next.applying || !next.queue || !next.recent || !next.updatedAt) {
        setError(next?.error ?? "خواندن وضعیت زنده ناموفق بود.");
        return;
      }
      setData(next as LiveApplyOverview);
    } catch {
      setError("اتصال زنده برقرار نشد.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 3500);
    return () => window.clearInterval(timer);
  }, []);

  const topQueue = useMemo(() => data.queue.slice(0, 12), [data.queue]);
  const topRecent = useMemo(() => data.recent.slice(0, 12), [data.recent]);

  return (
    <Card padded className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            نمای زنده
          </div>
          <h2 className="mt-3 text-xl font-extrabold tracking-tight">مرکز اپلای</h2>
          <p className="mt-1 text-sm leading-7 text-muted">
            این بخش خودش هر چند ثانیه به‌روز می‌شود.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">
            آخرین خواندن: {faDateTime(data.updatedAt)}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void refresh(false)}
            disabled={loading}
          >
            <IconRefresh className={cn("h-4 w-4", loading && "animate-spin")} />
            به‌روزرسانی
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-5 mt-5 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          <IconWarn className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      {data.execution.state === "blocked" ? (
        <div className="mb-5 mt-5 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300">
            <IconWarn className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-bold">اجرای سرور به‌خاطر بررسی امنیتی متوقف شد</p>
              <p className="mt-1 text-xs leading-6 text-muted">
                صف حفظ شده و هیچ درخواست دیگری از سرور ارسال نمی‌شود. افزونه را باز کنید و «ادامه با افزونه» را بزنید.
              </p>
            </div>
          </div>
          <a
            href="/dashboard/extension"
            className="focus-ring inline-flex shrink-0 items-center justify-center rounded-lg bg-foreground px-3 py-2 text-xs font-bold text-background"
          >
            باز کردن راهنمای افزونه
          </a>
        </div>
      ) : null}

      <div className="grid gap-5 pt-5 xl:grid-cols-[1fr_1.05fr_1.15fr]">
        <LiveColumn
          title="در حال ارسال"
          count={data.counts.applying}
          emptyTitle="فعلاً چیزی در حال ارسال نیست"
          emptyBody="به‌محضِ اینکه سرور یا افزونه یک آگهی را بردارد، همین‌جا دیده می‌شود."
        >
          {data.applying.map((job) => (
            <QueueJobCard key={job.taskId} job={job} active />
          ))}
        </LiveColumn>

        <LiveColumn
          title="در نوبتِ ارسال"
          count={data.queue.length}
          emptyTitle="نوبتِ ارسال خالی است"
          emptyBody="در صفحه‌ی اپلای خودکار شرط‌هایت را تنظیم کن تا آگهی‌های تازه وارد نوبت شوند."
        >
          {topQueue.map((job) => (
            <QueueJobCard key={job.taskId} job={job} />
          ))}
        </LiveColumn>

        <LiveColumn
          title="نتیجه‌های تازه"
          count={data.recent.length}
          emptyTitle="هنوز نتیجه‌ای ثبت نشده"
          emptyBody="بعد از اولین ارسال، وضعیت و رزومه‌ی همان اپلای این‌جا می‌آید."
        >
          {topRecent.map((item) => (
            <RecentResultCard key={item.applicationId} item={item} />
          ))}
        </LiveColumn>
      </div>
    </Card>
  );
}

function LiveColumn({
  title,
  count,
  emptyTitle,
  emptyBody,
  children,
}: {
  title: string;
  count?: number;
  emptyTitle: string;
  emptyBody: string;
  children: ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="min-w-0 rounded-2xl border border-border/70 bg-surface/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-bold">{title}</h3>
        {typeof count === "number" ? <Badge>{toFaDigits(count)}</Badge> : null}
      </div>
      <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
        {hasRows ? (
          children
        ) : (
          <EmptyState title={emptyTitle} body={emptyBody} className="border-0 bg-transparent py-8" />
        )}
      </div>
    </section>
  );
}

function QueueJobCard({ job, active = false }: { job: LiveApplyJob; active?: boolean }) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-3 shadow-xs",
        active ? "border-emerald-500/35" : "border-border/70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={job.listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm font-bold leading-6 hover:text-brand"
          >
            {job.listing.title}
          </a>
          <p className="mt-1 truncate text-xs text-muted">
            {job.listing.company ?? "—"}
            {job.listing.city ? ` · ${job.listing.city}` : ""}
          </p>
        </div>
        <Badge tone={active ? "green" : "muted"}>{job.listing.board}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.72rem] text-muted">
        {active ? (
          <span>شروع: {elapsed(job.leasedAt)}</span>
        ) : (
          <span>زمان اجرا: {faDateTime(job.runAfter)}</span>
        )}
        <span>تلاش: {toFaDigits(job.attempts)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={job.hasTailoredResume ? "green" : "amber"}>
          {job.hasTailoredResume ? "رزومه سفارشی دارد" : "در انتظار رزومه سفارشی"}
        </Badge>
        {job.lastError ? <Badge tone="rose">خطای قبلی</Badge> : null}
      </div>
    </article>
  );
}

function RecentResultCard({ item }: { item: LiveApplyResult }) {
  const status = STATUS_LABEL[item.status] ?? { label: item.status, tone: "muted" as const };
  return (
    <article className="rounded-xl border border-border/70 bg-card p-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={item.listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-sm font-bold leading-6 hover:text-brand"
          >
            {item.listing.title}
          </a>
          <p className="mt-1 truncate text-xs text-muted">
            {item.listing.company ?? "—"}
            {item.listing.city ? ` · ${item.listing.city}` : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.72rem] text-muted">
        <span>{faDateTime(item.happenedAt)}</span>
        <span>{item.channel === "worker" ? "سرور" : item.channel === "extension" ? "افزونه" : "—"}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.hasResume ? (
          <a
            href={`/api/applications/${item.applicationId}/resume`}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-brand-foreground hover:brightness-110"
          >
            <IconDoc className="h-3.5 w-3.5" />
            رزومه ارسالی
          </a>
        ) : (
          <Badge tone="amber">بدون رزومه سفارشی</Badge>
        )}
        <Badge>{item.listing.board}</Badge>
      </div>
    </article>
  );
}

export function LiveApplyPanelSkeleton() {
  return (
    <Card padded>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.05fr_1.15fr]">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-80 rounded-2xl" />
        ))}
      </div>
    </Card>
  );
}
