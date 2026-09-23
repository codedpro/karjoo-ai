/**
 * فرمِ یکپارچه‌ی فیلترِ شغل‌ها — همان یک فرم در همه‌ی فهرست‌ها: کاریابِ عمومی، شغل‌های
 * داشبورد و بایگانیِ ارسال‌ها. پیش‌تر هر صفحه جست‌وجوی خودش را داشت و «جست‌وجو» در هر
 * صفحه معنای دیگری می‌داد؛ حالا فیلترها، برچسب‌ها و رفتار یکی‌اند.
 *
 * یک فرمِ سادهِ GET است: بدونِ جاوااسکریپت هم کار می‌کند و هر نتیجه یک نشانیِ قابلِ
 * اشتراک است. همه‌ی متن‌ها فارسی‌اند.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { IconSearch } from "@/components/dashboard/icons";
import {
  ACTIVE_BOARDS,
  BOARD_LABELS,
  CATEGORY_OPTIONS,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_TYPES,
  POSTED_LABELS,
  POSTED_WITHIN,
  hasActiveFilters,
  type UnifiedJobFilters,
} from "@/lib/apply/job-filter-options";

const control =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus-visible:border-brand";

export interface JobFiltersFormProps {
  /** مسیرِ همین صفحه — فرم به خودش ارسال می‌شود. */
  action: string;
  filters: UnifiedJobFilters;
  /** شهرهایی که واقعاً آگهی دارند (پرتعدادترین اول). */
  cities: ReadonlyArray<{ city: string; count: number }>;
  /** «تاریخ انتشار» — برای بایگانیِ ارسال‌ها معنا ندارد. */
  showPosted?: boolean;
  /** کنترل‌های ویژه‌ی همان صفحه (مثلاً «اپلای‌شده/نشده» برای کاربرِ واردشده). */
  extra?: ReactNode;
  /** پارامترهایی که باید با فرم بمانند (مرتب‌سازی، اندازه‌ی صفحه). */
  hidden?: Record<string, string>;
}

export function JobFiltersForm({
  action,
  filters,
  cities,
  showPosted = true,
  extra,
  hidden = {},
}: JobFiltersFormProps) {
  // شهرِ انتخاب‌شده‌ای که در فهرستِ پرتعدادها نیست هم باید در منو بماند.
  const cityOptions =
    filters.city && !cities.some((c) => c.city === filters.city)
      ? [{ city: filters.city, count: 0 }, ...cities]
      : cities;

  return (
    <form
      action={action}
      method="get"
      role="search"
      aria-label="فیلترِ شغل‌ها"
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">جست‌وجو</span>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3">
            <IconSearch className="h-4 w-4 shrink-0 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="عنوانِ شغل، نامِ شرکت یا مهارت"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/60"
            />
          </div>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">دسته‌ی شغلی</span>
          <select name="category" defaultValue={filters.category ?? ""} className={control}>
            <option value="">همه‌ی دسته‌ها</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">شهر</span>
          <select name="city" defaultValue={filters.city ?? ""} className={control}>
            <option value="">همه‌ی شهرها</option>
            {cityOptions.map((c) => (
              <option key={c.city} value={c.city}>
                {c.city}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">سایت</span>
          <select name="board" defaultValue={filters.board ?? ""} className={control}>
            <option value="">همه‌ی سایت‌ها</option>
            {ACTIVE_BOARDS.map((board) => (
              <option key={board} value={board}>
                {BOARD_LABELS[board]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-muted">نوعِ همکاری</span>
          <select name="type" defaultValue={filters.type ?? ""} className={control}>
            <option value="">همه</option>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMPLOYMENT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        {showPosted ? (
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted">تاریخِ انتشار</span>
            <select name="posted" defaultValue={filters.posted ? String(filters.posted) : ""} className={control}>
              <option value="">هر زمان</option>
              {POSTED_WITHIN.map((days) => (
                <option key={days} value={days}>
                  {POSTED_LABELS[days]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex h-10 items-center gap-2 self-end rounded-xl border border-border bg-surface px-3 text-sm">
          <input
            type="checkbox"
            name="remote"
            value="1"
            defaultChecked={filters.remote}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          فقط دورکاری
        </label>
      </div>

      {extra ? <div className="flex flex-wrap gap-2">{extra}</div> : null}

      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-brand-foreground transition-transform active:translate-y-px">
          <IconSearch className="h-4 w-4" />
          جست‌وجو
        </button>
        {hasActiveFilters(filters) ? (
          <Link
            href={action}
            className="focus-ring inline-flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:bg-foreground/5 hover:text-foreground"
          >
            حذفِ فیلترها
          </Link>
        ) : null}
      </div>
    </form>
  );
}
