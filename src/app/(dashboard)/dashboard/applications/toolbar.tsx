/**
 * نوارِ ابزارِ صفحه‌ی اپلای‌ها — فیلترِ وضعیت، مرتب‌سازی، جست‌وجو و صفحه‌بندی.
 *
 * همه‌چیز با **لینک و فرمِ GET** کار می‌کند، نه state سمتِ کلاینت. سه دلیل: وضعیتِ فیلتر در
 * خودِ URL می‌ماند (قابلِ اشتراک و بوکمارک و بازگشت با دکمه‌ی back)، مرتب‌سازی/صفحه‌بندی
 * روی پایگاه‌داده انجام می‌شود نه روی آرایه‌ی رندرشده، و صفحه بدونِ هیچ جاوااسکریپتی کار
 * می‌کند. پس این کامپوننت سرور است و هیچ `use client` لازم ندارد.
 *
 * سلسله‌مراتبِ بصری (تصمیمِ تازه): این سنگین‌ترین نوارِ ابزارِ داشبورد بود، آن‌هم برای فهرستی
 * که معمولاً چند ده ردیف بیشتر نیست. حالا فقط چیپ‌های وضعیت — که خودشان خلاصه‌ی مفیدی‌اند —
 * همیشه دیده می‌شوند و مرتب‌سازی/جست‌وجو داخلِ یک `<details>`ِ جمع‌شده می‌روند که *فقط* وقتی
 * کاربر واقعاً از آن‌ها استفاده کرده باز است. `<details>` هم بدونِ جاوااسکریپت کار می‌کند، پس
 * قاعده‌ی «همه‌چیز با لینک و فرمِ GET» نمی‌شکند.
 */
import { ChevronDown } from "lucide-react";

import {
  APPLICATION_SORTS,
  APPLICATION_STATUSES,
  type ApplicationSort,
} from "@/lib/apply/applications-query";
import type { ApplicationStatusCategory } from "@/lib/apply/boards/jobinja-read";
import { Badge, cn, toFaDigits } from "@/components/dashboard/ui";

import { CATEGORY_META } from "./funnel";

const BASE = "/dashboard/applications";

export interface ToolbarState {
  status: ApplicationStatusCategory | null;
  q: string | null;
  sort: ApplicationSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** برچسبِ فارسیِ هر کلیدِ مرتب‌سازی. */
const SORT_LABEL: Record<ApplicationSort, string> = {
  applied: "زمانِ ارسالِ درخواست",
  posted: "زمانِ انتشارِ آگهی",
  status: "وضعیت",
  company: "نامِ شرکت",
};

/**
 * URLِ همین صفحه با چند پارامترِ عوض‌شده می‌سازد.
 * هر تغییرِ فیلتر/مرتب‌سازی صفحه را به ۱ برمی‌گرداند — وگرنه کاربر در صفحه‌ی ۷ فیلتری
 * می‌زند که فقط ۲ صفحه نتیجه دارد و به فهرستِ خالی می‌رسد.
 */
export function buildUrl(state: ToolbarState, patch: Partial<ToolbarState>): string {
  const next = { ...state, ...patch };
  if (!("page" in patch)) next.page = 1;
  const p = new URLSearchParams();
  if (next.status) p.set("status", next.status);
  if (next.q) p.set("q", next.q);
  if (next.sort !== "applied") p.set("sort", next.sort);
  if (next.dir !== "desc") p.set("dir", next.dir);
  if (next.page > 1) p.set("page", String(next.page));
  if (next.pageSize !== 25) p.set("pageSize", String(next.pageSize));
  const qs = p.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

/** چیپ‌های فیلترِ وضعیت — هر کدام با شمارِ واقعیِ همان دسته. */
export function StatusFilter({
  state,
  counts,
}: {
  state: ToolbarState;
  counts: Record<ApplicationStatusCategory, number> & { total: number };
}) {
  const chips: { key: ApplicationStatusCategory | null; label: string; n: number }[] = [
    { key: null, label: "همه", n: counts.total },
    ...APPLICATION_STATUSES.map((k) => ({
      key: k,
      label: CATEGORY_META[k].label,
      n: counts[k],
    })),
  ];

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="فیلترِ وضعیت">
      {chips.map((c) => {
        const active = state.status === c.key;
        // دسته‌ی خالی را نشان نمی‌دهیم مگر خودش فعال باشد — چیپی که به فهرستِ خالی می‌رساند
        // فقط شلوغی است. («همه» همیشه می‌ماند.)
        if (c.key !== null && c.n === 0 && !active) return null;
        return (
          <a
            key={c.key ?? "all"}
            href={buildUrl(state, { status: c.key })}
            aria-current={active ? "true" : undefined}
            className={cn(
              "focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
              active
                ? "border-brand bg-brand/10 font-bold text-brand"
                : "border-foreground/10 text-muted hover:border-foreground/25 hover:text-foreground",
            )}
          >
            <span>{c.label}</span>
            <span className="ltr-nums tabular-nums opacity-70">{toFaDigits(c.n)}</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * مرتب‌سازی + جست‌وجو، جمع‌شده در یک `<details>`.
 *
 * پیش‌فرض بسته است تا صفحه آرام بماند؛ اگر کاربر جست‌وجو یا مرتب‌سازیِ غیرپیش‌فرض دارد،
 * باز باز می‌شود — وگرنه فیلترِ فعالش نامرئی می‌شد و نمی‌فهمید چرا فهرست کوتاه است.
 */
export function ToolbarDetails({ state }: { state: ToolbarState }) {
  const touched = Boolean(state.q) || state.sort !== "applied" || state.dir !== "desc";
  return (
    <details open={touched} className="group">
      <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors marker:content-[''] hover:text-foreground">
        <span>مرتب‌سازی و جست‌وجو</span>
        <ChevronDown
          strokeWidth={1.75}
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border bg-surface/50 p-3 lg:flex-row lg:items-center lg:justify-between">
        <SortControls state={state} />
        <SearchBox state={state} />
      </div>
    </details>
  );
}

/** انتخابِ ستونِ مرتب‌سازی + جهت. */
export function SortControls({ state }: { state: ToolbarState }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">مرتب‌سازی بر اساسِ</span>
      {APPLICATION_SORTS.map((s) => {
        const active = state.sort === s;
        return (
          <a
            key={s}
            href={buildUrl(state, { sort: s })}
            className={cn(
              "focus-ring rounded-lg px-2.5 py-1.5 transition",
              active
                ? "bg-foreground/10 font-bold text-foreground"
                : "text-muted hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {SORT_LABEL[s]}
          </a>
        );
      })}
      <a
        href={buildUrl(state, { dir: state.dir === "desc" ? "asc" : "desc" })}
        className="focus-ring inline-flex items-center gap-1 rounded-lg border border-foreground/10 px-2.5 py-1.5 text-muted transition hover:border-foreground/25 hover:text-foreground"
        title={state.dir === "desc" ? "نزولی — برای صعودی کلیک کن" : "صعودی — برای نزولی کلیک کن"}
      >
        <span aria-hidden>{state.dir === "desc" ? "↓" : "↑"}</span>
        <span>{state.dir === "desc" ? "نزولی" : "صعودی"}</span>
      </a>
    </div>
  );
}

/** جست‌وجوی متنی روی عنوانِ آگهی و نامِ شرکت (فرمِ GET، بدونِ جاوااسکریپت). */
export function SearchBox({ state }: { state: ToolbarState }) {
  return (
    <form action={BASE} method="get" className="flex items-center gap-2">
      {/* فیلتر و مرتب‌سازیِ فعال با جست‌وجو حفظ می‌شود. */}
      {state.status ? <input type="hidden" name="status" value={state.status} /> : null}
      {state.sort !== "applied" ? <input type="hidden" name="sort" value={state.sort} /> : null}
      {state.dir !== "desc" ? <input type="hidden" name="dir" value={state.dir} /> : null}
      <input
        type="search"
        name="q"
        defaultValue={state.q ?? ""}
        placeholder="جست‌وجو در عنوان یا شرکت…"
        aria-label="جست‌وجو در عنوانِ آگهی یا نامِ شرکت"
        className="focus-ring w-full rounded-xl border border-foreground/10 bg-transparent px-3 py-2 text-sm placeholder:text-muted/70 sm:w-64"
      />
      <button
        type="submit"
        className="focus-ring rounded-xl border border-foreground/10 px-3 py-2 text-xs text-muted transition hover:border-foreground/25 hover:text-foreground"
      >
        جست‌وجو
      </button>
      {state.q ? (
        <a
          href={buildUrl(state, { q: null })}
          className="focus-ring rounded-xl px-2 py-2 text-xs text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          پاک‌کردن
        </a>
      ) : null}
    </form>
  );
}

/** صفحه‌بندی — قبلی/بعدی + پنجره‌ای از شماره‌ها حولِ صفحه‌ی جاری. */
export function Pagination({
  state,
  pageCount,
  filteredTotal,
}: {
  state: ToolbarState;
  pageCount: number;
  filteredTotal: number;
}) {
  if (pageCount <= 1) return null;
  const from = (state.page - 1) * state.pageSize + 1;
  const to = Math.min(filteredTotal, state.page * state.pageSize);

  // پنجره‌ی ۵تایی: با ۲۰ صفحه، ردیفِ ۲۰ لینکِ شماره‌دار فقط نویز است.
  const first = Math.max(1, Math.min(state.page - 2, pageCount - 4));
  const numbers = Array.from({ length: Math.min(5, pageCount) }, (_, i) => first + i).filter(
    (n) => n >= 1 && n <= pageCount,
  );

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/10 pt-4"
      aria-label="صفحه‌بندی"
    >
      <div className="text-xs text-muted">
        <span className="ltr-nums">{toFaDigits(from)}</span>
        {" تا "}
        <span className="ltr-nums">{toFaDigits(to)}</span>
        {" از "}
        <span className="ltr-nums font-semibold text-foreground">{toFaDigits(filteredTotal)}</span>
      </div>
      <div className="flex items-center gap-1">
        <PageLink href={buildUrl(state, { page: state.page - 1 })} disabled={state.page <= 1}>
          قبلی
        </PageLink>
        {numbers.map((n) => (
          <PageLink key={n} href={buildUrl(state, { page: n })} active={n === state.page}>
            <span className="ltr-nums">{toFaDigits(n)}</span>
          </PageLink>
        ))}
        <PageLink
          href={buildUrl(state, { page: state.page + 1 })}
          disabled={state.page >= pageCount}
        >
          بعدی
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  children,
  active,
  disabled,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  const cls = cn(
    "focus-ring min-w-9 rounded-lg px-2.5 py-1.5 text-center text-xs transition",
    active
      ? "bg-brand font-bold text-brand-foreground"
      : "border border-foreground/10 text-muted hover:border-foreground/25 hover:text-foreground",
  );
  if (disabled) {
    return (
      <span aria-disabled className={cn(cls, "cursor-not-allowed opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} className={cls} aria-current={active ? "page" : undefined}>
      {children}
    </a>
  );
}

/** خلاصه‌ی «چه چیزی الان نشان داده می‌شود» — وقتی فیلتری فعال است. */
export function ActiveFilterNote({ state, shown }: { state: ToolbarState; shown: number }) {
  if (!state.status && !state.q) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Badge tone="brand">
        <span className="ltr-nums tabular-nums">{toFaDigits(shown)}</span>&nbsp;نتیجه
      </Badge>
      {state.status ? <span>وضعیت: {CATEGORY_META[state.status].label}</span> : null}
      {state.q ? <span>جست‌وجو: «{state.q}»</span> : null}
      <a href={BASE} className="focus-ring underline underline-offset-4 hover:text-foreground">
        حذفِ فیلترها
      </a>
    </div>
  );
}
