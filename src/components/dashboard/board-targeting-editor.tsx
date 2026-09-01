"use client";

/**
 * «دنبالِ چه شغلی بگردیم؟» — یک سایت در هر لحظه.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * چرا این‌طور بازنویسی شد: ویرایشگرِ قبلی یک مجموعه‌ی *مشترک* فیلتر نشان می‌داد، اما
 * چهار سایت دسته‌بندی‌های کاملاً متفاوتی دارند و کلیدشان هم یکی نیست — جابینجا slug،
 * جاب‌ویژن urlTitle، ای‌استخدام نامِ فارسی، ایران‌تلنت شناسه‌ی عددی. آن صفحه در عمل فقط
 * جابینجا را تنظیم می‌کرد و سه سایتِ دیگر تنها از داخلِ افزونه قابلِ تنظیم بودند.
 *
 * حالا مثلِ خودِ افزونه: اول سایت را انتخاب می‌کنی، بعد فقط فیلدهایی را می‌بینی که همان
 * سایت واقعاً پشتیبانی می‌کند. فیلدی که روی یک سایت اثر ندارد اصلاً نمایش داده نمی‌شود
 * — «حداقل حقوق» و «ترتیب» فقط در جابینجا معنا دارند و «شهر» در جاب‌ویژن و ایران‌تلنت
 * نادیده گرفته می‌شود.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, useState } from "react";

import { Badge, Button, Card, cn } from "./ui";

export type BoardId = "jobinja" | "jobvision" | "e-estekhdam" | "irantalent";

export interface CatalogOption {
  key: string;
  label: string;
  englishLabel?: string;
}

export interface BoardCatalogs {
  categories: CatalogOption[];
  employmentTypes: CatalogOption[];
}

export interface BoardFilterState {
  enabled: boolean;
  categoryKeys: string[];
  cities: string[];
  employmentTypeKeys: string[];
  remoteOnly: boolean;
  minSalary?: number;
  sort?: string;
}

export interface TargetingProps {
  boards: BoardId[];
  labels: Record<string, string>;
  catalogs: Record<string, BoardCatalogs>;
  initial: Record<string, BoardFilterState>;
  /** سایت‌هایی که کاربر واقعاً وصل کرده — بقیه تنظیم‌شدنی‌اند ولی اجرا نمی‌شوند. */
  connected: string[];
  globals: { paused: boolean; dailyLimit?: number; maxAgeDays: number };
}

/** فیلدهایی که هر سایت واقعاً اعمال می‌کند — از خودِ کدِ کشف استخراج شده، نه حدس. */
const SUPPORTS: Record<BoardId, { cities: boolean; salary: boolean; sort: boolean }> = {
  jobinja: { cities: true, salary: true, sort: true },
  "e-estekhdam": { cities: true, salary: false, sort: false },
  jobvision: { cities: false, salary: false, sort: false },
  irantalent: { cities: false, salary: false, sort: false },
};

const SORT_OPTIONS = [
  { value: "published_at_desc", label: "تازه‌ترین" },
  { value: "relevance_desc", label: "مرتبط‌ترین" },
  { value: "salary_from_desc", label: "بیشترین حقوق" },
];

export function BoardTargetingEditor(props: TargetingProps) {
  const [active, setActive] = useState<BoardId>(props.boards[0] ?? "jobinja");
  const [boards, setBoards] = useState(props.initial);
  const [globals, setGlobals] = useState(props.globals);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const board = boards[active]!;
  const catalog = props.catalogs[active] ?? { categories: [], employmentTypes: [] };
  const supports = SUPPORTS[active];

  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.categories;
    return catalog.categories.filter((c) =>
      `${c.label} ${c.englishLabel ?? ""}`.toLowerCase().includes(q),
    );
  }, [catalog.categories, query]);

  function patch(next: Partial<BoardFilterState>) {
    setBoards((prev) => ({ ...prev, [active]: { ...prev[active]!, ...next } }));
    setDone(null);
  }

  function toggleKey(field: "categoryKeys" | "employmentTypeKeys", key: string) {
    const current = board[field];
    patch({
      [field]: current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    } as Partial<BoardFilterState>);
  }

  async function save() {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/apply/filters", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // فیلدهای تختِ قدیمی = همان فیلترِ جابینجا (قراردادِ سرور).
          categorySlugs: boards.jobinja?.categoryKeys ?? [],
          cities: boards.jobinja?.cities ?? [],
          jobTypes: boards.jobinja?.employmentTypeKeys ?? [],
          remoteOnly: boards.jobinja?.remoteOnly ?? false,
          ...(boards.jobinja?.minSalary ? { minSalary: boards.jobinja.minSalary } : {}),
          ...(boards.jobinja?.sort ? { sort: boards.jobinja.sort } : {}),
          paused: globals.paused,
          ...(globals.dailyLimit ? { dailyLimit: globals.dailyLimit } : {}),
          maxAgeDays: globals.maxAgeDays,
          boardFiltersVersion: 1,
          boardFilters: boards,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        filters?: unknown;
        queueReset?: { removed: number; boards: string[] };
      };
      if (!res.ok) {
        setError(data.error ?? "ذخیره نشد. کمی بعد دوباره تلاش کنید.");
        return;
      }
      setDone(
        data.queueReset && data.queueReset.removed > 0
          ? `ذخیره شد؛ ${data.queueReset.removed.toLocaleString("fa-IR")} مورد قدیمی از صف حذف شد.`
          : "ذخیره شد.",
      );
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padded>
      {/* ── ۱) کدام سایت؟ ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="سایت کاریابی">
        {props.boards.map((id) => {
          const isActive = id === active;
          const on = boards[id]?.enabled;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => { setActive(id); setQuery(""); }}
              className={cn(
                "rounded-xl border px-3 py-2 text-sm transition-colors",
                isActive
                  ? "border-brand/40 bg-brand/10 text-foreground"
                  : "border-border bg-background text-muted hover:border-foreground/20 hover:text-foreground",
              )}
            >
              {props.labels[id] ?? id}
              <span className={cn("mr-2 text-xs", on ? "text-emerald-600 dark:text-emerald-400" : "text-muted")}>
                {on ? "روشن" : "خاموش"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-6">
        {/* ── ۲) این سایت روشن باشد؟ ─────────────────────────────────── */}
        <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
          <input
            type="checkbox"
            className="mt-1"
            checked={board.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium">
              کارجو در {props.labels[active]} برایم بگردد و درخواست بفرستد
            </span>
            <span className="mt-1 block text-xs text-muted">
              {props.connected.includes(active)
                ? "این سایت متصل است."
                : "هنوز وصل نشده — از صفحهٔ «اتصال‌ها» وصلش کنید وگرنه اجرا نمی‌شود."}
            </span>
          </span>
        </label>

        {/* ── ۳) دسته‌های همین سایت ──────────────────────────────────── */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">دسته‌های شغلی در {props.labels[active]}</h3>
            <Badge tone="muted">{board.categoryKeys.length} انتخاب</Badge>
          </div>
          <p className="mb-3 text-xs text-muted">
            هر سایت دسته‌بندی خودش را دارد، پس انتخاب هر سایت جداگانه است.
          </p>
          {catalog.categories.length === 0 ? (
            <p className="text-sm text-muted">
              فهرست دسته‌های این سایت در دسترس نیست. بعداً دوباره تلاش کنید.
            </p>
          ) : (
            <>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجوی دسته"
                className="focus-ring mb-3 min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
              />
              <div className="grid max-h-72 gap-1 overflow-y-auto pl-1 sm:grid-cols-2">
                {visibleCategories.map((option) => (
                  <label key={option.key} className="flex min-h-9 items-center gap-2 rounded-lg p-1.5 text-sm hover:bg-foreground/5">
                    <input
                      type="checkbox"
                      checked={board.categoryKeys.includes(option.key)}
                      onChange={() => toggleKey("categoryKeys", option.key)}
                    />
                    <span className="min-w-0 truncate">{option.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── ۴) شرایط — فقط آن‌هایی که این سایت اعمال می‌کند ─────────── */}
        <section className="grid gap-4 sm:grid-cols-2">
          {catalog.employmentTypes.length > 0 ? (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">نوع همکاری</legend>
              <div className="flex flex-wrap gap-2">
                {catalog.employmentTypes.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={board.employmentTypeKeys.includes(option.key)}
                      onChange={() => toggleKey("employmentTypeKeys", option.key)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={board.remoteOnly}
              onChange={(e) => patch({ remoteOnly: e.target.checked })}
            />
            فقط آگهی‌های دورکاری
          </label>

          {supports.cities ? (
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span className="text-muted">شهرها</span>
              <input
                type="text"
                value={board.cities.join("، ")}
                onChange={(e) =>
                  patch({
                    cities: e.target.value.split(/[,،]/).map((v) => v.trim()).filter(Boolean),
                  })
                }
                placeholder="تهران، اصفهان"
                className="focus-ring min-h-11 rounded-xl border border-border bg-background px-3 py-2 outline-none"
              />
            </label>
          ) : null}

          {supports.salary ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">حداقل حقوق (تومان)</span>
              <input
                type="number"
                min={0}
                value={board.minSalary ?? ""}
                onChange={(e) => patch({ minSalary: Number(e.target.value) || undefined })}
                className="focus-ring min-h-11 rounded-xl border border-border bg-background px-3 py-2 outline-none"
                dir="ltr"
              />
            </label>
          ) : null}

          {supports.sort ? (
            <label className="grid gap-1 text-sm">
              <span className="text-muted">ترتیب نتایج</span>
              <select
                value={board.sort ?? "published_at_desc"}
                onChange={(e) => patch({ sort: e.target.value })}
                className="focus-ring min-h-11 rounded-xl border border-border bg-background px-3 py-2 outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </section>

        {/* ── ۵) تنظیم‌های مشترکِ همه‌ی سایت‌ها ───────────────────────── */}
        <section className="grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
          <p className="text-sm font-medium sm:col-span-2">این‌ها برای همهٔ سایت‌ها یکی است</p>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">حداکثر تعداد ارسال در روز</span>
            <input
              type="number"
              min={0}
              value={globals.dailyLimit ?? ""}
              onChange={(e) => {
                setGlobals((g) => ({ ...g, dailyLimit: Number(e.target.value) || undefined }));
                setDone(null);
              }}
              className="focus-ring min-h-11 rounded-xl border border-border bg-background px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">آگهی‌های تازه‌تر از (روز)</span>
            <input
              type="number"
              min={1}
              max={45}
              value={globals.maxAgeDays}
              onChange={(e) => {
                setGlobals((g) => ({ ...g, maxAgeDays: Number(e.target.value) || 45 }));
                setDone(null);
              }}
              className="focus-ring min-h-11 rounded-xl border border-border bg-background px-3 py-2 outline-none"
              dir="ltr"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={globals.paused}
              onChange={(e) => {
                setGlobals((g) => ({ ...g, paused: e.target.checked }));
                setDone(null);
              }}
            />
            فعلاً هیچ آگهی تازه‌ای پیدا و صف نشود
          </label>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={pending}>
            {pending ? "در حال ذخیره…" : "ذخیره"}
          </Button>
          {done ? <span className="text-sm text-emerald-600 dark:text-emerald-400">{done}</span> : null}
          {error ? <span className="text-sm text-rose-600 dark:text-rose-400">{error}</span> : null}
        </div>
      </div>
    </Card>
  );
}
