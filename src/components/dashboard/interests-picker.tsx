"use client";

/**
 * انتخابگرِ «زمینه‌های شغلی» (client component، RTL).
 *
 * گروه‌ها و انتخاب‌های اولیه از سرور (RSC) می‌آیند؛ این کامپوننت فقط حالتِ انتخاب را
 * مدیریت و با PUT /api/interests ذخیره می‌کند. سرور منبعِ حقیقت است: پاسخِ PUT slugهای
 * واقعاً اعمال‌شده را برمی‌گرداند و ما همان را می‌نشانیم. هیچ داده‌ی حساسی این‌جا نیست —
 * فقط slug/برچسبِ عمومیِ تاکسونومی + انتخابِ همین کاربر.
 *
 * دو تغییرِ اصلی نسبت به نسخه‌ی قبل، هر دو برای «پیداکردن» به‌جای «ورق‌زدن»:
 *   • **جست‌وجوی زنده.** ۲۶ چیپ در یک صفحه یعنی کاربر باید همه را بخواند تا یکی را پیدا
 *     کند. حالا تایپِ چند حرف (فارسی یا انگلیسی) فهرست را فیلتر می‌کند.
 *   • **گروه‌های عنوان‌دار با شمارشِ انتخاب.** هر گروه می‌گوید چندتا از آن انتخاب شده، پس
 *     کاربر بدونِ اسکرول می‌فهمد کجا ایستاده است.
 *
 * زبانِ بصری روی پرایمیتیوهای مشترک (Button/Badge/EmptyState) و آیکن‌های lucide سوار است
 * (بدونِ ایموجی). چیپ‌ها `focus-ring` و `aria-pressed` دارند و `whitespace-nowrap`اند.
 */
import { useMemo, useState } from "react";

import { Badge, Button, EmptyState, cn, toFaDigits } from "./ui";
import { IconCheck, IconClose, IconHeart, IconSearch } from "./icons";

/** یک دسته‌ی تاکسونومی که UI لازم دارد (زیرمجموعه‌ی CategoryRow). */
export interface PickerCategory {
  slug: string;
  labelFa: string;
  labelEn: string;
}

/** یک گروهِ نمایشی: عنوان (یا null برای فهرستِ بی‌گروه) + دسته‌های زیرِ آن. */
export interface PickerGroup {
  label: string | null;
  categories: PickerCategory[];
}

/** آیا این دسته با عبارتِ جست‌وجو می‌خواند؟ هم برچسبِ فارسی، هم انگلیسی، هم slug. */
function matches(cat: PickerCategory, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    cat.labelFa.toLowerCase().includes(q) ||
    cat.labelEn.toLowerCase().includes(q) ||
    cat.slug.toLowerCase().includes(q)
  );
}

export function InterestsPicker({
  groups,
  initialSelected,
}: {
  groups: PickerGroup[];
  initialSelected: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected),
  );
  const [saved, setSaved] = useState<Set<string>>(() => new Set(initialSelected));
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.categories.length, 0),
    [groups],
  );

  // فیلترِ جست‌وجو: گروه‌های بی‌نتیجه کلاً حذف می‌شوند تا عنوانِ خالی نماند.
  const visibleGroups = useMemo(() => {
    const q = query.trim();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, categories: g.categories.filter((c) => matches(c, q)) }))
      .filter((g) => g.categories.length > 0);
  }, [groups, query]);

  // آیا انتخابِ فعلی با آخرین حالتِ ذخیره‌شده تفاوت دارد؟ (برای فعال/غیرفعالِ دکمه).
  const dirty = useMemo(() => {
    if (selected.size !== saved.size) return true;
    for (const s of selected) if (!saved.has(s)) return true;
    return false;
  }, [selected, saved]);

  function toggle(slug: string) {
    setDone(false);
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function save() {
    setPending(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/interests", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs: [...selected] }),
      });
      const data: { slugs?: string[]; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "ذخیره‌سازی ناموفق بود. کمی بعد دوباره تلاش کنید.");
        return;
      }
      // سرور منبعِ حقیقت: slugهای واقعاً اعمال‌شده را بنشان (نامعتبرها حذف شده).
      const applied = new Set(data.slugs ?? [...selected]);
      setSelected(applied);
      setSaved(applied);
      setDone(true);
    } catch {
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید.");
    } finally {
      setPending(false);
    }
  }

  // حالتِ خالی: تاکسونومی خالی رسیده (صفحه خودش هم گاردِ جداگانه دارد؛ این لایه‌ی دوم است).
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={<IconHeart />}
        title="هنوز زمینه‌ی شغلی‌ای برای انتخاب نیست"
        body="به‌زودی زمینه‌های شغلی این‌جا اضافه می‌شوند. تا آن‌وقت کارجو با فیلترهای «اپلای خودکار» کار می‌کند."
      />
    );
  }

  return (
    <div>
      {/* نوارِ وضعیت + ذخیره (چسبان زیرِ هدرِ ۶۴px + کمی فاصله) */}
      <div className="sticky top-18 z-20 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-sm backdrop-blur-md">
        <p className="text-sm text-muted">
          <span className="ltr-nums font-bold text-foreground">
            {toFaDigits(selected.size)}
          </span>{" "}
          از <span className="ltr-nums">{toFaDigits(totalCount)}</span> زمینه انتخاب شده
        </p>
        <div className="flex items-center gap-3">
          {error ? (
            <span role="alert" className="text-sm text-rose-600 dark:text-rose-400">
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
            {pending ? "در حال ذخیره…" : "ذخیره‌ی انتخاب‌ها"}
          </Button>
        </div>
      </div>

      {/* جست‌وجو — راهِ سریعِ رسیدن به یک زمینه‌ی مشخص بدونِ خواندنِ همه‌ی چیپ‌ها */}
      <SearchBox value={query} onChange={setQuery} />

      {/* گروه‌ها */}
      {visibleGroups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-10 text-center">
          <p className="text-sm text-muted">
            زمینه‌ای با «<span className="font-medium text-foreground">{query}</span>»
            پیدا نشد.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => setQuery("")}
          >
            نمایشِ همه‌ی زمینه‌ها
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group, gi) => {
            const picked = group.categories.filter((c) => selected.has(c.slug)).length;
            return (
              <section key={group.label ?? `g-${gi}`}>
                {group.label ? (
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-sm font-bold text-muted">{group.label}</h2>
                    {picked > 0 ? (
                      <Badge tone="brand">{toFaDigits(picked)} انتخاب‌شده</Badge>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2.5">
                  {group.categories.map((cat) => {
                    const isOn = selected.has(cat.slug);
                    return (
                      <button
                        key={cat.slug}
                        type="button"
                        onClick={() => toggle(cat.slug)}
                        aria-pressed={isOn}
                        className={cn(
                          "focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,transform] active:translate-y-px",
                          isOn
                            ? "border-brand/50 bg-brand/10 text-brand"
                            : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground",
                        )}
                      >
                        {isOn ? <IconCheck className="h-4 w-4" /> : null}
                        <span>{cat.labelFa}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────  جعبه‌ی جست‌وجو  ───────────────────────────── */

/** ورودیِ فیلترِ زنده — برچسبِ واقعی (پنهانِ بصری) دارد تا screen reader هم بفهمد. */
function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-6">
      <label htmlFor="interests-search" className="sr-only">
        جست‌وجو در زمینه‌های شغلی
      </label>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute inset-y-0 start-4 my-auto h-4 w-4 text-muted" />
        <input
          id="interests-search"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="جست‌وجو — مثلاً «حسابداری» یا design"
          className="focus-ring w-full rounded-xl border border-border bg-card py-3 pe-11 ps-11 text-sm outline-none placeholder:text-muted/70"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="پاک‌کردنِ جست‌وجو"
            className="focus-ring absolute inset-y-0 end-3 my-auto grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-foreground/5 hover:text-foreground"
          >
            <IconClose className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
