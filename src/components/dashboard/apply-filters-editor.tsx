"use client";

/**
 * ویرایشگرِ «فیلترهای اپلای» (client component, RTL) — قلبِ جریانِ پیش‌فرضِ محصول.
 *
 * کاربر فیلترهای *خودِ جابینجا* را می‌چیند (دسته، شهر، نوعِ همکاری، دورکاری، حداقلِ حقوق،
 * ترتیب) و کارجو به همه‌ی آگهی‌های همین جست‌وجو اپلای می‌کند — بدونِ نیاز به AI. تطبیقِ
 * هوشمند یک لایه‌ی *اختیاریِ پریمیوم* روی این است (Track C/Phase 4)، نه پیش‌نیاز.
 *
 * داده‌ی اولیه از RSC می‌آید؛ این کامپوننت فقط حالتِ انتخاب را نگه می‌دارد و با
 * PUT /api/apply/filters ذخیره می‌کند. سرور منبعِ حقیقت است: پاسخِ ذخیره فیلترهای مؤثر و
 * URLِ پیش‌نمایش را برمی‌گرداند و همان می‌نشیند. هیچ داده‌ی حساسی این‌جا نیست؛ userId هرگز
 * از کلاینت نمی‌رود — سرور از نشست می‌گیرد (§۱۰).
 *
 * پیش‌نمایشِ «زنده»: هنگامِ ویرایش (پیش از ذخیره) URLِ هدف با آینه‌ی سبکِ
 * buildJobinjaPreviewUrl بازساخته می‌شود تا کاربر فوری ببیند به چه جست‌وجویی اپلای خواهد
 * شد؛ رشته‌ی اولیه از سرور (buildSearchUrl) می‌آید تا اولین رندر بی‌درنگ و بدونِ ناهمگونی باشد.
 */
import { useMemo, useState } from "react";
import { Briefcase, Globe, Search } from "lucide-react";

import { Badge, Button, cn, toFaDigits } from "./ui";
import { FindJobsButton } from "./find-jobs-button";
import {
  IconChart,
  IconCheck,
  IconChecklist,
  IconClose,
  IconMapPin,
  IconPlus,
  IconSparkle,
  IconTarget,
  IconWallet,
} from "./icons";
import {
  DEFAULT_SORT,
  JOB_TYPE_OPTIONS,
  SORT_OPTIONS,
  buildJobinjaPreviewUrl,
  type CategoryOption,
  type JobTypeValue,
  type SortValue,
} from "@/lib/apply/apply-filters-form";

/** فیلترهای اولیه که RSC پاس می‌دهد (زیرمجموعه‌ی ApplyFilters). */
export interface InitialApplyFilters {
  categorySlugs: string[];
  cities: string[];
  jobTypes: string[];
  remoteOnly: boolean;
  minSalary?: number;
  sort?: string;
}

/** پاسخِ PUT/GET /api/apply/filters. */
interface FiltersApiResult {
  filters?: InitialApplyFilters;
  previewUrl?: string;
  error?: string;
}

/* حالتِ داخلیِ ویرایشگر — یک شیِ واحد تا سریالایز/آینه ساده بماند. */
interface EditorState {
  categorySlugs: string[];
  cities: string[];
  jobTypes: JobTypeValue[];
  remoteOnly: boolean;
  minSalary: number | null;
  sort: SortValue;
}

function toState(f: InitialApplyFilters): EditorState {
  const jobTypes = JOB_TYPE_OPTIONS.map((o) => o.value).filter((v) =>
    f.jobTypes.includes(v),
  );
  const sort = SORT_OPTIONS.some((o) => o.value === f.sort)
    ? (f.sort as SortValue)
    : DEFAULT_SORT;
  return {
    categorySlugs: [...f.categorySlugs],
    cities: [...f.cities],
    jobTypes,
    remoteOnly: f.remoteOnly === true,
    minSalary: typeof f.minSalary === "number" && f.minSalary > 0 ? f.minSalary : null,
    sort,
  };
}

/** امضای پایدارِ حالت برای تشخیصِ «تغییرِ ذخیره‌نشده» (آرایه‌ها مرتب، sortِ پیش‌فرض نرمال). */
function signature(s: EditorState): string {
  return JSON.stringify({
    c: [...s.categorySlugs].sort(),
    l: [...s.cities].sort(),
    t: [...s.jobTypes].sort(),
    r: s.remoteOnly,
    m: s.minSalary ?? 0,
    s: s.sort, // پیش‌فرض هم صریح مقایسه می‌شود چون همیشه مقدار دارد
  });
}

/** آینه‌ی فیلترها برای URLِ پیش‌نمایش (sortِ پیش‌فرض → بدونِ پارامتر، مثلِ buildSearchUrl). */
function previewOf(s: EditorState): string {
  return buildJobinjaPreviewUrl({
    categorySlugs: s.categorySlugs,
    cities: s.cities,
    jobTypes: s.jobTypes,
    remoteOnly: s.remoteOnly,
    ...(s.minSalary ? { minSalary: s.minSalary } : {}),
    ...(s.sort !== DEFAULT_SORT ? { sort: s.sort } : {}),
  });
}

export function ApplyFiltersEditor({
  categories,
  categoriesPartial = false,
  initialFilters,
  initialPreviewUrl,
}: {
  categories: CategoryOption[];
  /** اگر لیستِ دسته‌ها از fallback آمد (نه زنده) — یک تذکرِ ظریف نشان می‌دهیم. */
  categoriesPartial?: boolean;
  initialFilters: InitialApplyFilters;
  initialPreviewUrl: string;
}) {
  const initialState = useMemo(() => toState(initialFilters), [initialFilters]);
  const [state, setState] = useState<EditorState>(initialState);
  const [savedSig, setSavedSig] = useState(() => signature(initialState));
  // اولین رندر: رشته‌ی سرور (buildSearchUrl) تا بی‌درنگ و بدونِ ناهمگونی باشد.
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl);

  const [catQuery, setCatQuery] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dirty = signature(state) !== savedSig;

  /** هر تغییرِ حالت را اعمال و پیش‌نمایشِ زنده را با آینه به‌روز می‌کند. */
  function apply(next: EditorState) {
    setState(next);
    setPreviewUrl(previewOf(next));
    setDone(false);
    setError(null);
  }

  /* ── دسته‌ها ── */
  const selectedCats = useMemo(() => new Set(state.categorySlugs), [state.categorySlugs]);
  const filteredCats = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) => c.name.toLowerCase().includes(q) || c.englishName.toLowerCase().includes(q),
    );
  }, [categories, catQuery]);

  function toggleCat(slug: string) {
    const has = selectedCats.has(slug);
    apply({
      ...state,
      categorySlugs: has
        ? state.categorySlugs.filter((s) => s !== slug)
        : [...state.categorySlugs, slug],
    });
  }

  /* ── شهرها ── */
  function addCity(raw: string) {
    const parts = raw
      .split(/[،,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...state.cities];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    apply({ ...state, cities: next });
    setCityDraft("");
  }
  function removeCity(city: string) {
    apply({ ...state, cities: state.cities.filter((c) => c !== city) });
  }

  /* ── نوعِ همکاری ── */
  function toggleType(v: JobTypeValue) {
    const has = state.jobTypes.includes(v);
    apply({
      ...state,
      jobTypes: has ? state.jobTypes.filter((t) => t !== v) : [...state.jobTypes, v],
    });
  }

  /* ── ذخیره ── */
  async function save() {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/apply/filters", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categorySlugs: state.categorySlugs,
          cities: state.cities,
          jobTypes: state.jobTypes,
          remoteOnly: state.remoteOnly,
          ...(state.minSalary && state.minSalary > 0 ? { minSalary: state.minSalary } : {}),
          ...(state.sort !== DEFAULT_SORT ? { sort: state.sort } : {}),
        }),
      });
      const data: FiltersApiResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.filters) {
        setError(data.error ?? "ذخیره‌ی فیلترها ناموفق بود. کمی بعد دوباره تلاش کنید.");
        return;
      }
      // سرور منبعِ حقیقت: فیلترهای مؤثر و URLِ رسمی را بنشان.
      const applied = toState(data.filters);
      setState(applied);
      setSavedSig(signature(applied));
      if (data.previewUrl) setPreviewUrl(data.previewUrl);
      else setPreviewUrl(previewOf(applied));
      setDone(true);
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید.");
    } finally {
      setPending(false);
    }
  }

  const selectedCount = state.categorySlugs.length;
  const hasAnyFilter =
    selectedCount > 0 ||
    state.cities.length > 0 ||
    state.jobTypes.length > 0 ||
    state.remoteOnly ||
    state.minSalary !== null;

  return (
    <div className="space-y-6">
      {/* ───── نوارِ چسبانِ وضعیت + ذخیره ───── */}
      <div className="sticky top-18 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-sm backdrop-blur-md">
        <p className="text-sm text-muted">
          <span className="ltr-nums font-bold text-foreground">
            {toFaDigits(selectedCount)}
          </span>{" "}
          دسته
          {state.cities.length > 0 ? (
            <>
              {" · "}
              <span className="ltr-nums font-bold text-foreground">
                {toFaDigits(state.cities.length)}
              </span>{" "}
              شهر
            </>
          ) : null}{" "}
          انتخاب شده
        </p>
        <div className="flex items-center gap-3">
          {error ? (
            <span role="alert" className="text-sm text-rose-500">
              {error}
            </span>
          ) : null}
          {done && !dirty ? (
            <Badge tone="green">
              <IconCheck className="h-3.5 w-3.5" />
              ذخیره شد
            </Badge>
          ) : null}
          <Button type="button" onClick={save} disabled={pending || !dirty} size="sm">
            {pending ? "در حال ذخیره…" : "ذخیره‌ی فیلترها"}
          </Button>
        </div>
      </div>

      {/* ───── اقدامِ «جست‌وجوی مشاغل» — مستقل از ذخیره ───── */}
      <FindJobsButton />

      {/* ───── پیش‌نمایشِ هدف ───── */}
      <TargetPreview
        url={previewUrl}
        hasAnyFilter={hasAnyFilter}
        categoryCount={selectedCount}
        cityCount={state.cities.length}
        jobTypeCount={state.jobTypes.length}
        remoteOnly={state.remoteOnly}
        minSalary={state.minSalary}
      />

      {/* ───── دسته‌ها ───── */}
      <Field
        icon={<IconChecklist className="h-4 w-4" />}
        title="دسته‌بندی‌های شغلی"
        hint="از دسته‌های خودِ جابینجا انتخاب کنید؛ به همه‌ی آگهی‌های این دسته‌ها اپلای می‌شود."
        badge={
          selectedCount > 0 ? (
            <Badge tone="brand">{toFaDigits(selectedCount)} انتخاب</Badge>
          ) : null
        }
      >
        {categoriesPartial ? (
          <p className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-600 dark:text-amber-400">
            فهرستِ دسته‌ها به‌طورِ کامل بارگیری نشد؛ ممکن است بخشی از دسته‌ها این‌جا نباشد.
          </p>
        ) : null}
        <div className="relative mb-3">
          <Search
            className="pointer-events-none absolute inset-y-0 end-3 my-auto h-4 w-4 text-muted"
            aria-hidden
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder="جست‌وجوی دسته (فارسی یا انگلیسی)…"
            className="focus-ring w-full rounded-xl border border-border bg-surface/60 py-2.5 pe-10 ps-4 text-sm placeholder:text-muted/70"
            aria-label="جست‌وجوی دسته‌بندی"
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-surface/40 p-2">
          {filteredCats.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              دسته‌ای با «{catQuery}» پیدا نشد.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {filteredCats.map((cat) => {
                const on = selectedCats.has(cat.slug);
                return (
                  <button
                    key={cat.slug}
                    type="button"
                    onClick={() => toggleCat(cat.slug)}
                    aria-pressed={on}
                    className={cn(
                      "focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-[background-color,border-color,color,transform] active:translate-y-px",
                      on
                        ? "border-brand/50 bg-brand/10 text-brand"
                        : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground",
                    )}
                  >
                    {on ? <IconCheck className="h-4 w-4" /> : null}
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Field>

      {/* ───── شهرها ───── */}
      <Field
        icon={<IconMapPin className="h-4 w-4" />}
        title="شهرها"
        hint="نامِ شهر را بنویسید و Enter بزنید. خالی = همه‌ی شهرها."
      >
        {state.cities.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {state.cities.map((city) => (
              <span
                key={city}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 py-1.5 pe-2 ps-3.5 text-sm font-medium text-brand"
              >
                {city}
                <button
                  type="button"
                  onClick={() => removeCity(city)}
                  className="focus-ring grid h-5 w-5 place-items-center rounded-full text-brand/70 hover:bg-brand/15 hover:text-brand"
                  aria-label={`حذفِ ${city}`}
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addCity(cityDraft);
              }
            }}
            placeholder="مثلاً تهران، اصفهان…"
            className="focus-ring min-w-0 flex-1 rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm placeholder:text-muted/70"
            aria-label="افزودنِ شهر"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => addCity(cityDraft)}
            disabled={cityDraft.trim().length === 0}
          >
            <IconPlus className="h-4 w-4" />
            افزودن
          </Button>
        </div>
      </Field>

      {/* ───── نوعِ همکاری + دورکاری ───── */}
      <Field
        icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
        title="نوعِ همکاری"
        hint="خالی = هر نوعِ همکاری."
      >
        <div className="flex flex-wrap gap-2">
          {JOB_TYPE_OPTIONS.map((opt) => {
            const on = state.jobTypes.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleType(opt.value)}
                aria-pressed={on}
                className={cn(
                  "focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,transform] active:translate-y-px",
                  on
                    ? "border-brand/50 bg-brand/10 text-brand"
                    : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {on ? <IconCheck className="h-4 w-4" /> : null}
                <span>{opt.labelFa}</span>
              </button>
            );
          })}
        </div>

        {/* دورکاری — سوییچ */}
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3">
          <span className="flex items-center gap-2.5 text-sm font-medium">
            <Globe className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />
            فقط آگهی‌های دورکاری
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={state.remoteOnly}
            aria-label="فقط دورکاری"
            onClick={() => apply({ ...state, remoteOnly: !state.remoteOnly })}
            className={cn(
              "focus-ring relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
              state.remoteOnly ? "bg-brand" : "bg-foreground/15",
            )}
          >
            <span
              className={cn(
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                state.remoteOnly ? "-translate-x-6" : "-translate-x-1",
              )}
            />
          </button>
        </div>
      </Field>

      {/* ───── حداقلِ حقوق ───── */}
      <Field
        icon={<IconWallet className="h-4 w-4" />}
        title="حداقلِ حقوق (ماهانه)"
        hint="آگهی‌هایی که حقوقِ کمتری اعلام کرده‌اند کنار گذاشته می‌شوند. خالی = بدونِ حداقل."
      >
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1_000_000}
              value={state.minSalary ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                apply({
                  ...state,
                  minSalary: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
                });
              }}
              placeholder="مثلاً ۱۵۰۰۰۰۰۰"
              className="focus-ring ltr-nums w-full rounded-xl border border-border bg-surface/60 py-2.5 pe-16 ps-4 text-sm placeholder:text-muted/70"
              aria-label="حداقلِ حقوق به تومان"
            />
            <span className="pointer-events-none absolute inset-y-0 end-4 my-auto flex items-center text-xs text-muted">
              تومان
            </span>
          </div>
          {state.minSalary ? (
            <span className="ltr-nums whitespace-nowrap rounded-full bg-brand/10 px-3 py-1 text-sm font-bold text-brand">
              {toFaDigits(state.minSalary.toLocaleString("en-US"))} تومان
            </span>
          ) : null}
        </div>
      </Field>

      {/* ───── ترتیبِ نتایج ───── */}
      <Field
        icon={<IconChart className="h-4 w-4" />}
        title="ترتیبِ نتایج"
        hint="کارجو آگهی‌ها را به همین ترتیب برمی‌دارد و اپلای می‌کند."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {SORT_OPTIONS.map((opt) => {
            const on = state.sort === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => apply({ ...state, sort: opt.value })}
                aria-pressed={on}
                className={cn(
                  "focus-ring flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-start transition-colors",
                  on
                    ? "border-brand/50 bg-brand/10"
                    : "border-border bg-card hover:border-foreground/20",
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-semibold",
                    on ? "text-brand" : "text-foreground",
                  )}
                >
                  {on ? <IconCheck className="h-4 w-4" /> : null}
                  {opt.labelFa}
                </span>
                {opt.hintFa ? (
                  <span className="text-xs text-muted">{opt.hintFa}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </Field>

      {/* ───── یادآوریِ «AI اختیاری است» ───── */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-surface/50 px-4 py-3.5 text-muted">
        <IconSparkle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p className="text-pretty text-xs leading-6">
          این فیلترها بدونِ هوش مصنوعی کار می‌کنند: کارجو به <strong className="font-semibold text-foreground">همه‌ی</strong>{" "}
          آگهی‌های این جست‌وجو اپلای می‌کند. «فیلترِ هوشمند (AI)» یک افزودنیِ اختیاریِ
          پریمیوم است که همین فهرست را باریک‌تر می‌کند — نه یک پیش‌نیاز.
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────  اجزای کمکی  ─────────────────────────────────── */

/** یک بخشِ فرم با سرسطرِ آیکن‌دار + توضیح + نشانِ اختیاری. */
function Field({
  icon,
  title,
  hint,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
              {icon}
            </span>
            {title}
          </h2>
          {hint ? (
            <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">{hint}</p>
          ) : null}
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** کارتِ «این جست‌وجو را هدف می‌گیرد» — خلاصه‌ی فیلترها + لینکِ زنده‌ی جابینجا. */
function TargetPreview({
  url,
  hasAnyFilter,
  categoryCount,
  cityCount,
  jobTypeCount,
  remoteOnly,
  minSalary,
}: {
  url: string;
  hasAnyFilter: boolean;
  categoryCount: number;
  cityCount: number;
  jobTypeCount: number;
  remoteOnly: boolean;
  minSalary: number | null;
}) {
  const chips: string[] = [];
  if (categoryCount > 0) chips.push(`${toFaDigits(categoryCount)} دسته`);
  if (cityCount > 0) chips.push(`${toFaDigits(cityCount)} شهر`);
  if (jobTypeCount > 0) chips.push(`${toFaDigits(jobTypeCount)} نوعِ همکاری`);
  if (remoteOnly) chips.push("فقط دورکاری");
  if (minSalary) chips.push(`حقوق از ${toFaDigits(minSalary.toLocaleString("en-US"))}`);

  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/[0.06] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
          <IconTarget className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-base font-bold">این جست‌وجو را هدف می‌گیرد</h2>
          {hasAnyFilter ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center whitespace-nowrap rounded-full bg-card px-2.5 py-0.5 text-xs font-medium text-muted ring-1 ring-inset ring-border"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-pretty text-xs leading-6 text-muted">
              هنوز فیلتری انتخاب نکرده‌اید — این یعنی همه‌ی آگهی‌های جابینجا. برای هدف‌گیریِ
              دقیق‌تر، دسته و شهر انتخاب کنید.
            </p>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
          >
            دیدنِ همین جست‌وجو در جابینجا
            <span aria-hidden>↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}
