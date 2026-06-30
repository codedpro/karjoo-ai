"use client";

/**
 * پیکرِ گروهیِ دسته‌بندیِ علاقه‌مندی (client component، RTL).
 *
 * دسته‌ها و انتخاب‌های اولیه از سرور (RSC) می‌آیند؛ این کامپوننت فقط حالتِ انتخاب را
 * مدیریت و با PUT /api/interests ذخیره می‌کند. سرور منبعِ حقیقت است: پاسخِ PUT
 * slugهای واقعاً اعمال‌شده را برمی‌گرداند و ما همان را می‌نشانیم. هیچ داده‌ی حساسی اینجا
 * نیست — فقط slug/برچسبِ عمومیِ تاکسونومی + انتخابِ همین کاربر.
 */
import { useMemo, useState } from "react";

import { toFaDigits } from "./ui";

/** یک دسته‌ی تاکسونومی که UI لازم دارد (زیرمجموعه‌ی CategoryRow). */
export interface PickerCategory {
  slug: string;
  labelFa: string;
  labelEn: string;
}

/** یک گروه: عنوانِ والد (یا null برای دسته‌های ریشه) + دسته‌های زیرِ آن. */
export interface PickerGroup {
  parentLabelFa: string | null;
  categories: PickerCategory[];
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.categories.length, 0),
    [groups],
  );

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

  return (
    <div>
      {/* نوارِ وضعیت + ذخیره (چسبان در بالا) */}
      <div className="sticky top-20 z-10 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 backdrop-blur-md">
        <p className="text-sm text-muted">
          <span className="ltr-nums font-bold text-foreground">
            {toFaDigits(selected.size)}
          </span>{" "}
          از{" "}
          <span className="ltr-nums">{toFaDigits(totalCount)}</span> دسته انتخاب شده
        </p>
        <div className="flex items-center gap-3">
          {error ? <span className="text-sm text-rose-500">{error}</span> : null}
          {done && !dirty ? (
            <span className="text-sm text-emerald-500">ذخیره شد ✓</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="rounded-full bg-gradient-to-br from-brand to-brand-2 px-5 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-50"
          >
            {pending ? "در حال ذخیره…" : "ذخیره‌ی علاقه‌مندی‌ها"}
          </button>
        </div>
      </div>

      {/* گروه‌ها */}
      <div className="space-y-8">
        {groups.map((group, gi) => (
          <section key={group.parentLabelFa ?? `g-${gi}`}>
            {group.parentLabelFa ? (
              <h2 className="mb-3 text-sm font-bold text-muted">
                {group.parentLabelFa}
              </h2>
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
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      isOn
                        ? "border-brand/50 bg-brand/10 text-brand"
                        : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground"
                    }`}
                  >
                    <span>{cat.labelFa}</span>
                    {isOn ? <span className="ms-1.5">✓</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
