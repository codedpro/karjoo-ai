"use client";

/**
 * انتخابگرِ «هوش مصنوعیِ کارجو» (client component, RTL).
 *
 * کاتالوگ، انتخابِ اولیه و modelIdِ پیشنهادی از سرور (RSC) می‌آیند؛ این کامپوننت فقط
 * انتخاب و ذخیره با PUT /api/ai-settings را مدیریت می‌کند. سرور منبعِ حقیقت است: پاسخِ
 * PUT همان modelIdِ واقعاً ذخیره‌شده را برمی‌گرداند و ما همان را می‌نشانیم. هیچ داده‌ی
 * حساسی این‌جا نیست — فقط برچسب/قیمتِ عمومیِ مدل + انتخابِ همین کاربر.
 *
 * بازنویسیِ ضدِ اصطلاحاتِ فنی — مخاطب کارجوست، نه مهندسِ AI:
 *   • **تب‌های provider حذف شد.** «OpenAI / Anthropic / Google» برای کارجو معنایی ندارد و
 *     صفحه را با یک تصمیمِ بی‌ربط شروع می‌کرد. حالا یک فهرستِ تخت است و نامِ ارائه‌دهنده
 *     فقط در جزئیاتِ فنی می‌ماند.
 *   • **پیشنهادِ کارجو اول و بزرگ.** اکثریتِ کاربران نباید چیزی را عوض کنند؛ صفحه همین
 *     را می‌گوید و بقیه‌ی گزینه‌ها بعد از آن می‌آیند.
 *   • **توصیف با نتیجه، نه با مشخصات.** هر مدل یک جمله دارد: دقیق‌تر / سریع‌تر / ارزان‌تر /
 *     فارسیِ بهتر. هزینه به‌صورتِ نسبی («کم/متوسط/زیاد») نشان داده می‌شود، چون «تومان به‌ازای
 *     هر ۱۰۰۰ توکن» عددی است که کارجو نمی‌تواند با آن تصمیم بگیرد.
 *   • **عددِ خام حذف نشد، فقط ثانویه شد.** قیمتِ دقیق، شناسه‌ی مدل، ارائه‌دهنده و پنجره‌ی
 *     متن داخلِ `<details>`ِ «جزئیاتِ فنی» می‌مانند برای کسی که واقعاً می‌خواهد.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { IconBolt, IconCheck, IconSparkle } from "./icons";
import { Badge, Button, Card, EmptyState, cn, toFaDigits } from "./ui";
import { MODEL_TAGS, MODEL_TAG_ORDER } from "./labels";

/** یک مدلِ کاتالوگ که UI لازم دارد (زیرمجموعه‌ی CatalogModel + برچسبِ ارائه‌دهنده). */
export interface PickerModel {
  modelId: string;
  displayName: string;
  /** نامِ نمایشیِ ارائه‌دهنده — فقط در «جزئیاتِ فنی» دیده می‌شود. */
  providerLabel: string;
  inputPer1kToman: number;
  outputPer1kToman: number;
  contextWindow: number | null;
  tags: string[];
}

/* ───────────────────────────  کمک‌کننده‌های نمایشی  ─────────────────────────── */

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

type CostTier = "low" | "mid" | "high";

const COST_TIER_LABEL: Record<CostTier, { label: string; tone: "green" | "amber" | "rose" }> = {
  low: { label: "هزینه‌ی کم", tone: "green" },
  mid: { label: "هزینه‌ی متوسط", tone: "amber" },
  high: { label: "هزینه‌ی بالا", tone: "rose" },
};

/**
 * هزینه‌ی *نسبی* هر مدل نسبت به بقیه‌ی کاتالوگ (سه‌بخشی).
 *
 * چرا نسبی؟ چون عددِ مطلقِ «تومان/۱۰۰۰ توکن» بدونِ دانستنِ مصرف بی‌معناست؛ ولی «این از آن
 * ارزان‌تر است» دقیقاً همان چیزی است که کاربر می‌خواهد بداند. مبنا مجموعِ ورودی+خروجی است
 * (تقریبِ ساده و پایدار). اگر همه هم‌قیمت باشند، همه «متوسط» می‌شوند.
 */
function buildCostTiers(models: PickerModel[]): Map<string, CostTier> {
  const blended = models.map((m) => ({
    id: m.modelId,
    price: m.inputPer1kToman + m.outputPer1kToman,
  }));
  const prices = [...new Set(blended.map((b) => b.price))].sort((a, b) => a - b);
  const tiers = new Map<string, CostTier>();
  if (prices.length < 3) {
    for (const b of blended) tiers.set(b.id, "mid");
    return tiers;
  }
  const lowCut = prices[Math.floor((prices.length - 1) / 3)];
  const midCut = prices[Math.floor((2 * (prices.length - 1)) / 3)];
  for (const b of blended) {
    tiers.set(b.id, b.price <= lowCut ? "low" : b.price <= midCut ? "mid" : "high");
  }
  return tiers;
}

/**
 * یک جمله‌ی «این برای من چه معنایی دارد؟» از روی تگ‌های مدل. ترتیب اهمیت دارد: بارزترین
 * ویژگی برنده می‌شود تا هر کارت *یک* پیام بدهد، نه فهرستی از صفت‌ها.
 */
function benefitLine(tags: string[], isRecommended: boolean): string {
  if (isRecommended || tags.includes("recommended")) {
    return "تعادلِ خوبِ دقت و هزینه — برای اغلبِ کاربران بهترین انتخاب.";
  }
  if (tags.includes("premium")) return "دقیق‌ترین نتیجه‌ها؛ در عوض گران‌تر است.";
  if (tags.includes("persian")) return "فارسی را روان‌تر می‌نویسد و بهتر می‌فهمد.";
  if (tags.includes("fast")) return "سریع‌تر جواب می‌دهد؛ برای حجمِ زیادِ آگهی خوب است.";
  if (tags.includes("cheap")) return "کم‌هزینه‌ترین گزینه برای مصرفِ روزانه‌ی زیاد.";
  return "گزینه‌ی جایگزین؛ اگر پیشنهادِ کارجو مناسبتان نبود امتحانش کنید.";
}

/* ─────────────────────────────────  پیکر  ───────────────────────────────── */

export function ModelPicker({
  models,
  initialSelectedModelId,
  recommendedModelId,
  /** انتخابِ فعلی، انتخابِ صریحِ کاربر است یا پیش‌فرضِ سیستم؟ */
  isDefaultSelection,
}: {
  models: PickerModel[];
  initialSelectedModelId: string | null;
  recommendedModelId: string | null;
  isDefaultSelection: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelectedModelId);
  const [savedModelId, setSavedModelId] = useState<string | null>(
    initialSelectedModelId,
  );
  const [touched, setTouched] = useState(false);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const costTiers = useMemo(() => buildCostTiers(models), [models]);

  // پیشنهادِ کارجو اول؛ بقیه به ترتیبِ ارزان‌به‌گران تا مقایسه طبیعی باشد.
  const { featured, others } = useMemo(() => {
    const feat = models.find((m) => m.modelId === recommendedModelId) ?? null;
    const rest = models
      .filter((m) => m.modelId !== feat?.modelId)
      .sort(
        (a, b) =>
          a.inputPer1kToman + a.outputPer1kToman -
          (b.inputPer1kToman + b.outputPer1kToman),
      );
    return { featured: feat, others: rest };
  }, [models, recommendedModelId]);

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
      setTouched(true);
    } catch {
      setSelected(savedModelId);
      setError("اتصال برقرار نشد. اینترنت را بررسی کنید.");
    } finally {
      setPendingModelId(null);
    }
  }

  if (models.length === 0) {
    return (
      <EmptyState
        icon={<IconSparkle />}
        title="فهرستِ مدل‌ها هنوز آماده نیست"
        body="تا وقتی این فهرست پر شود، کارجو با مدلِ پیش‌فرض کار می‌کند و چیزی از کارِ شما زمین نمی‌ماند. کمی بعد دوباره سر بزنید."
      />
    );
  }

  // «پیش‌فرض» فقط تا وقتی است که کاربر خودش چیزی انتخاب نکرده باشد.
  const stillDefault = isDefaultSelection && !touched;

  return (
    <div className="space-y-8">
      {error ? (
        <div
          role="alert"
          className="text-pretty rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </div>
      ) : null}

      {/* ── پیشنهادِ کارجو (کارتِ شاخص) ── */}
      {featured ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <IconSparkle className="h-4 w-4 text-brand" />
            پیشنهادِ کارجو
          </h2>
          <ModelCard
            model={featured}
            featured
            costTier={costTiers.get(featured.modelId) ?? "mid"}
            isSelected={featured.modelId === selected}
            isSaved={featured.modelId === savedModelId}
            isRecommended
            isDefaultBadge={stillDefault && featured.modelId === savedModelId}
            isPending={featured.modelId === pendingModelId}
            onSelect={() => select(featured.modelId)}
          />
        </section>
      ) : null}

      {/* ── بقیه‌ی گزینه‌ها ── */}
      {others.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <IconBolt className="h-4 w-4 text-muted" />
            گزینه‌های دیگر
            <span className="text-xs font-normal text-muted">
              (فقط اگر دلیلِ مشخصی دارید)
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((model) => (
              <ModelCard
                key={model.modelId}
                model={model}
                costTier={costTiers.get(model.modelId) ?? "mid"}
                isSelected={model.modelId === selected}
                isSaved={model.modelId === savedModelId}
                isRecommended={false}
                isDefaultBadge={stillDefault && model.modelId === savedModelId}
                isPending={model.modelId === pendingModelId}
                onSelect={() => select(model.modelId)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────  کارتِ یک مدل  ───────────────────────────── */

function ModelCard({
  model,
  costTier,
  isSelected,
  isSaved,
  isRecommended,
  isDefaultBadge,
  isPending,
  featured = false,
  onSelect,
}: {
  model: PickerModel;
  costTier: CostTier;
  isSelected: boolean;
  isSaved: boolean;
  isRecommended: boolean;
  /** انتخابِ فعلی، پیش‌فرضِ سیستم است (نه انتخابِ صریحِ کاربر). */
  isDefaultBadge: boolean;
  isPending: boolean;
  featured?: boolean;
  onSelect: () => void;
}) {
  const context = formatContext(model.contextWindow);
  const cost = COST_TIER_LABEL[costTier];
  // تگ‌ها را به ترتیبِ اهمیت مرتب کن (و ناشناخته‌ها را در انتها نگه دار).
  const orderedTags = useMemo(() => {
    const known = MODEL_TAG_ORDER.filter((t) => model.tags.includes(t));
    const rest = model.tags.filter(
      (t) => !(MODEL_TAG_ORDER as readonly string[]).includes(t),
    );
    return [...known, ...rest];
  }, [model.tags]);

  return (
    <Card
      padded
      className={cn(
        "flex flex-col",
        isSelected && "border-brand/60 ring-1 ring-brand/30",
        featured && "bg-brand/4",
      )}
    >
      {/* سرِ کارت: نامِ خوانا + وضعیتِ انتخاب */}
      <div className="flex items-start justify-between gap-3">
        <h3
          className={cn(
            "text-balance font-bold",
            featured ? "text-lg" : "text-base",
          )}
        >
          {model.displayName}
        </h3>
        {isSaved ? (
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-brand-foreground">
            {isDefaultBadge ? "پیش‌فرضِ فعال" : "انتخابِ شما"}
            <IconCheck className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>

      {/* یک جمله: این مدل برای کاربر یعنی چه */}
      <p className="mt-2 text-pretty text-sm leading-7 text-muted">
        {benefitLine(model.tags, isRecommended)}
      </p>

      {/* نشان‌های خوانا: هزینه‌ی نسبی + ویژگی‌ها */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={cost.tone}>{cost.label}</Badge>
        {orderedTags.map((tag) => {
          const meta = MODEL_TAGS[tag];
          return (
            <Badge key={tag} tone={meta?.tone ?? "muted"} title={meta?.title}>
              {meta?.label ?? tag}
            </Badge>
          );
        })}
      </div>

      {/* جزئیاتِ فنی — عمداً بسته و ثانویه؛ برای کاربرِ کنجکاو، نه برای تصمیمِ اصلی */}
      <details className="group mt-4 rounded-xl border border-border bg-surface/50">
        <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium text-muted [&::-webkit-details-marker]:hidden">
          جزئیاتِ فنی و قیمتِ دقیق
          <ChevronDown
            className="me-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <dl className="space-y-2 border-t border-border/70 px-3.5 py-3 text-xs">
          <DetailRow label="ارائه‌دهنده" value={model.providerLabel} />
          <DetailRow label="شناسه‌ی مدل" value={model.modelId} ltr />
          <DetailRow
            label="ورودی (هر ۱۰۰۰ توکن)"
            value={`${formatToman(model.inputPer1kToman)} تومان`}
          />
          <DetailRow
            label="خروجی (هر ۱۰۰۰ توکن)"
            value={`${formatToman(model.outputPer1kToman)} تومان`}
          />
          {context ? <DetailRow label="پنجره‌ی متن" value={context} /> : null}
        </dl>
      </details>

      {/* اکشنِ انتخاب — همیشه در کفِ کارت تا در شبکه هم‌تراز بماند */}
      <Button
        type="button"
        onClick={onSelect}
        disabled={isSaved || isPending}
        aria-pressed={isSelected}
        variant={isSaved ? "secondary" : "primary"}
        className={cn("mt-5 w-full", isSaved && "cursor-default")}
      >
        {isPending
          ? "در حال ذخیره…"
          : isSaved
            ? "همین فعال است"
            : "استفاده از این مدل"}
      </Button>
    </Card>
  );
}

/** یک ردیفِ جزئیاتِ فنی (برچسب/مقدار). */
function DetailRow({
  label,
  value,
  ltr = false,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd
        className={cn("min-w-0 truncate font-medium", ltr && "ltr-nums")}
        dir={ltr ? "ltr" : undefined}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
