/**
 * اجزای ارائه‌ایِ کوچکِ مشترکِ داشبورد (بدون state، server-safe).
 *
 * این‌ها فقط استایل/چیدمان‌اند تا کارت‌ها/صفحه‌های داشبورد یکدست بمانند و با
 * استایلِ لندینگِ موجود (border/card/brand) هم‌خوان باشند. هیچ رازی، هیچ I/O.
 */
import type { ReactNode } from "react";

/** ارقامِ فارسی برای حسِ بومی — اعداد را به ۰۹ فارسی نگاشت می‌کند. */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** کارتِ پایه — همان قابِ border/card که در لندینگ استفاده شده. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card ${className}`}>
      {children}
    </div>
  );
}

/** عنوانِ بخش با زیرعنوانِ اختیاری. */
export function SectionHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-muted">{subtitle}</p> : null}
    </div>
  );
}

type BadgeTone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: "bg-brand/10 text-brand",
  accent: "bg-accent/10 text-accent",
  muted: "bg-foreground/5 text-muted",
  green: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
};

/** نشانِ کوچکِ وضعیت/برچسب. */
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * حلقه‌ی امتیازِ تطبیق (۰..۱ → درصد). با conic-gradient رندر می‌شود تا بدونِ SVG/JS
 * کار کند و در RTL هم درست بنشیند.
 */
export function ScoreRing({ score }: { score: number | null }) {
  const pct = Math.round(Math.min(1, Math.max(0, score ?? 0)) * 100);
  return (
    <div
      className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--brand) ${pct}%, color-mix(in oklab, var(--border) 70%, transparent) 0)`,
      }}
      aria-label={`امتیاز تطبیق ${pct} درصد`}
    >
      <div className="grid h-11 w-11 place-items-center rounded-full bg-card">
        <span className="ltr-nums text-sm font-bold">{toFaDigits(pct)}</span>
      </div>
    </div>
  );
}

/** حالتِ خالی — وقتی هنوز داده‌ای نیست. */
export function EmptyState({
  icon = "📭",
  title,
  body,
  action,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-3xl">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      {body ? (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-muted">{body}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** اسکلتِ بارگذاری — برای Suspense/loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-foreground/5 ${className}`}
      aria-hidden
    />
  );
}
