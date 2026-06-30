"use client";

/**
 * مدل‌پیکرِ هوش مصنوعی (client component, RTL) — Track A.
 *
 * کاتالوگِ گروه‌بندی‌شده، انتخابِ اولیه و modelIdِ recommended از سرور (RSC) می‌آیند؛
 * این کامپوننت فقط تب‌های provider، انتخابِ مدل و ذخیره با PUT /api/ai-settings را
 * مدیریت می‌کند. سرور منبعِ حقیقت است: پاسخِ PUT modelIdِ واقعاً ذخیره‌شده را برمی‌گرداند
 * و ما همان را می‌نشانیم. هیچ داده‌ی حساسی اینجا نیست — فقط قیمت/برچسبِ عمومیِ مدل +
 * انتخابِ همین کاربر (که route به نشستِ همان کاربر مقید کرده).
 */
import { useMemo, useState } from "react";

import { Badge, toFaDigits } from "./ui";
import { MODEL_TAGS, MODEL_TAG_ORDER } from "./labels";

/** یک مدلِ کاتالوگ که UI لازم دارد (زیرمجموعه‌ی CatalogModel). */
export interface PickerModel {
  modelId: string;
  displayName: string;
  inputPer1kToman: number;
  outputPer1kToman: number;
  contextWindow: number | null;
  tags: string[];
}

/** یک گروهِ provider: شناسه + برچسبِ نمایشی + مدل‌های زیرِ آن. */
export interface PickerProviderGroup {
  provider: string;
  label: string;
  models: PickerModel[];
}

/** قیمتِ تومان را با جداکننده‌ی هزارگان و ارقامِ فارسی نمایش می‌دهد. */
function formatToman(value: number): string {
  return toFaDigits(value.toLocaleString("en-US"));
}

/** پنجره‌ی متن را خوانا نمایش می‌دهد (۱۲۸٬۰۰۰ → «۱۲۸ هزار»، ۱٬۰۰۰٬۰۰۰ → «۱ میلیون»). */
function formatContext(tokens: number | null): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${toFaDigits(Number.isInteger(m) ? m : m.toFixed(1))} میلیون توکن`;
  }
  if (tokens >= 1_000) {
    return `${toFaDigits(Math.round(tokens / 1_000))} هزار توکن`;
  }
  return `${toFaDigits(tokens)} توکن`;
}

export function ModelPicker({
  groups,
  initialSelectedModelId,
  recommendedModelId,
}: {
  groups: PickerProviderGroup[];
  initialSelectedModelId: string | null;
  recommendedModelId: string | null;
}) {
  // تبِ فعال: provider مدلِ انتخابی، وگرنه اولین گروه.
  const initialProvider = useMemo(() => {
    const owning = groups.find((g) =>
      g.models.some((m) => m.modelId === initialSelectedModelId),
    );
    return owning?.provider ?? groups[0]?.provider ?? null;
  }, [groups, initialSelectedModelId]);

  const [activeProvider, setActiveProvider] = useState<string | null>(
    initialProvider,
  );
  const [selected, setSelected] = useState<string | null>(initialSelectedModelId);
  const [savedModelId, setSavedModelId] = useState<string | null>(
    initialSelectedModelId,
  );
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.provider === activeProvider) ?? groups[0] ?? null,
    [groups, activeProvider],
  );

  async function select(modelId: string) {
    if (modelId === savedModelId || pendingModelId) return;
    setError(null);
    setSelected(modelId);
    setPendingModelId(modelId);
    try {
      const res = await fetch("/api/ai-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const data: { modelId?: string; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        // ناموفق → انتخاب را به آخرین حالتِ ذخیره‌شده برگردان.
        setSelected(savedModelId);
        setError(data.error ?? "ذخیره‌سازی ناموفق بود. کمی بعد دوباره تلاش کنید.");
        return;
      }
      // سرور منبعِ حقیقت: modelIdِ واقعاً ذخیره‌شده را بنشان.
      const applied = data.modelId ?? modelId;
      setSelected(applied);
      setSavedModelId(applied);
    } catch {
      setSelected(savedModelId);
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید.");
    } finally {
      setPendingModelId(null);
    }
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
        <h3 className="text-lg font-bold">هنوز مدلی در دسترس نیست</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-muted">
          کاتالوگِ مدل‌ها هنوز همگام نشده است. کمی بعد دوباره سر بزنید.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* وضعیتِ خطا (انتخاب به‌صورتِ خودکار ذخیره می‌شود) */}
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      ) : null}

      {/* تب‌های provider */}
      <div
        role="tablist"
        aria-label="ارائه‌دهنده‌ی هوش مصنوعی"
        className="flex flex-wrap gap-2"
      >
        {groups.map((g) => {
          const isActive = g.provider === activeProvider;
          const hasSelected = g.models.some((m) => m.modelId === selected);
          return (
            <button
              key={g.provider}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveProvider(g.provider)}
              className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                isActive
                  ? "border-brand/50 bg-brand/10 text-brand"
                  : "border-border bg-card text-muted hover:border-foreground/20 hover:text-foreground"
              }`}
            >
              {g.label}
              {hasSelected ? <span className="ms-1.5">●</span> : null}
            </button>
          );
        })}
      </div>

      {/* کارت‌های مدلِ گروهِ فعال */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {activeGroup?.models.map((model) => (
          <ModelCard
            key={model.modelId}
            model={model}
            isSelected={model.modelId === selected}
            isSaved={model.modelId === savedModelId}
            isRecommended={model.modelId === recommendedModelId}
            isPending={model.modelId === pendingModelId}
            onSelect={() => select(model.modelId)}
          />
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────  کارتِ یک مدل  ───────────────────────────── */

function ModelCard({
  model,
  isSelected,
  isSaved,
  isRecommended,
  isPending,
  onSelect,
}: {
  model: PickerModel;
  isSelected: boolean;
  isSaved: boolean;
  isRecommended: boolean;
  isPending: boolean;
  onSelect: () => void;
}) {
  const context = formatContext(model.contextWindow);
  // تگ‌ها را به ترتیبِ اهمیت مرتب کن (و ناشناخته‌ها را در انتها نگه دار).
  const orderedTags = useMemo(() => {
    const known = MODEL_TAG_ORDER.filter((t) => model.tags.includes(t));
    const rest = model.tags.filter(
      (t) => !(MODEL_TAG_ORDER as readonly string[]).includes(t),
    );
    return [...known, ...rest];
  }, [model.tags]);

  return (
    <div
      className={`relative flex flex-col rounded-2xl border bg-card p-5 transition-colors ${
        isSelected
          ? "border-brand/60 ring-1 ring-brand/30"
          : isRecommended
            ? "border-brand/30"
            : "border-border hover:border-foreground/20"
      }`}
    >
      {/* سرِ کارت: نام + نشانِ انتخاب‌شده */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold">{model.displayName}</h3>
          <p className="ltr-nums mt-0.5 truncate text-xs text-muted" dir="ltr">
            {model.modelId}
          </p>
        </div>
        {isSaved ? (
          <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">
            انتخاب‌شده ✓
          </span>
        ) : isRecommended ? (
          <Badge tone="brand">پیشنهادی</Badge>
        ) : null}
      </div>

      {/* تگ‌ها */}
      {orderedTags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {orderedTags.map((tag) => {
            const meta = MODEL_TAGS[tag];
            return (
              <span key={tag} title={meta?.title}>
                <Badge tone={meta?.tone ?? "muted"}>{meta?.label ?? tag}</Badge>
              </span>
            );
          })}
        </div>
      ) : null}

      {/* قیمت + پنجره‌ی متن */}
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <PriceCell label="ورودی / هزار توکن" value={model.inputPer1kToman} />
        <PriceCell label="خروجی / هزار توکن" value={model.outputPer1kToman} />
      </dl>
      {context ? (
        <p className="mt-3 text-xs text-muted">
          پنجره‌ی متن: <span className="ltr-nums font-medium">{context}</span>
        </p>
      ) : null}

      {/* اکشنِ انتخاب */}
      <button
        type="button"
        onClick={onSelect}
        disabled={isSaved || isPending}
        aria-pressed={isSelected}
        className={`mt-5 rounded-full px-4 py-2 text-sm font-bold transition-opacity ${
          isSaved
            ? "cursor-default bg-brand/10 text-brand"
            : "bg-gradient-to-br from-brand to-brand-2 text-white disabled:opacity-50"
        }`}
      >
        {isPending
          ? "در حال ذخیره…"
          : isSaved
            ? "مدلِ فعالِ شما"
            : "انتخابِ این مدل"}
      </button>
    </div>
  );
}

/** یک سلولِ قیمت (تومان به‌ازای هر ۱۰۰۰ توکن). */
function PriceCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-foreground/5 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="ltr-nums mt-0.5 font-bold">
        {formatToman(value)} <span className="text-xs font-normal text-muted">تومان</span>
      </dd>
    </div>
  );
}
