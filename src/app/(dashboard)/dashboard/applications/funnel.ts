/**
 * منطقِ خالصِ نمایشیِ «قیفِ اپلای» — نگاشتِ شمارشِ هر دسته به عرضِ نوار + برچسب/رنگِ فارسی.
 *
 * چرا فایلِ جدا (و *بدونِ* `server-only`)؟ تا هم صفحه‌ی سرور (RSC) و هم تستِ vitest از همین
 * تابعِ خالص استفاده کنند؛ هیچ I/O و هیچ رازی این‌جا نیست — فقط ریاضیِ درصد + متادیتای رنگ.
 *
 * لحن‌ها با تصمیمِ محصول هم‌راستا هستند: مصاحبه = مثبت/سبز، رد = خطر/رُز، بررسی = کهربایی،
 * در انتظار = خنثی/muted. کلاس‌های رنگ روی توکن‌های `globals.css`/tailwind سوارند تا با بقیه‌ی
 * داشبورد یکدست بمانند (نه رنگِ خام و پراکنده).
 *
 * برچسب‌ها **تنها منبعِ حقیقتِ نمایشیِ وضعیت** هستند: نشانِ هر ردیف هم از همین‌جا می‌آید، نه
 * از متنِ خامِ جابینجا. جابینجا برای یک معنی چند عبارتِ متفاوت می‌نویسد («در انتظارِ بررسی»،
 * «بررسی نشده»، …) و اگر خام نشان داده شود، فهرست از ردیفی به ردیفِ بعد بی‌قاعده می‌شود؛
 * عبارتِ دقیقِ سایت روی `title` نشان باقی می‌ماند تا چیزی گم نشود.
 */
import type { ApplicationFunnel } from "@/lib/apply/boards/jobinja-read";

/** دسته‌های قیف (بدونِ `total` که خودش جمعِ کل است). */
export type FunnelCategory =
  | "pending"
  | "review"
  | "interview"
  | "hired"
  | "rejected"
  | "other";

/** لحنِ سازگار با `ui.Badge` (زیرمجموعه‌ی BadgeTone که این‌جا لازم داریم). */
export type ApplyTone = "muted" | "amber" | "green" | "rose";

export interface CategoryMeta {
  /** برچسبِ فارسیِ دسته. */
  label: string;
  /** لحنِ Badge روی هر آیتمِ فهرست. */
  tone: ApplyTone;
  /** کلاسِ رنگِ نوارِ توپُرِ قیف. */
  barClass: string;
  /** کلاسِ رنگِ عددِ بزرگِ کارتِ آمار. */
  textClass: string;
}

/** متادیتای نمایشیِ هر دسته — منبعِ حقیقتِ برچسب/رنگِ قیف و نشانِ آیتم‌ها. */
export const CATEGORY_META: Record<FunnelCategory, CategoryMeta> = {
  pending: {
    label: "هنوز بررسی نشده",
    tone: "muted",
    barClass: "bg-foreground/25",
    textClass: "text-foreground",
  },
  review: {
    label: "در حالِ بررسی",
    tone: "amber",
    barClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  hired: {
    label: "استخدام",
    tone: "green",
    barClass: "bg-emerald-600",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  interview: {
    label: "دعوت به مصاحبه",
    tone: "green",
    barClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  rejected: {
    label: "رد شده",
    tone: "rose",
    barClass: "bg-rose-500",
    textClass: "text-rose-600 dark:text-rose-400",
  },
  other: {
    label: "نامشخص",
    tone: "muted",
    barClass: "bg-foreground/15",
    textClass: "text-muted",
  },
};

/** ترتیبِ قیف: از ورودی (در انتظار) → نتیجه (مصاحبه)، سپس رد و سایر. */
export const FUNNEL_ORDER: FunnelCategory[] = [
  "pending",
  "review",
  "interview",
  "hired",
  "rejected",
  "other",
];

export interface FunnelSegment extends CategoryMeta {
  key: FunnelCategory;
  count: number;
  /** درصدِ عرضِ نوار (۰..۱۰۰)، گِردشده به دو رقمِ اعشار. */
  pct: number;
}

/**
 * قیف را به قطعاتِ نوارِ نسبتی تبدیل می‌کند (به‌ترتیبِ `FUNNEL_ORDER`). عرضِ هر قطعه =
 * شمارشِ آن دسته ÷ کل ×۱۰۰. اگر کل صفر باشد همه‌ی عرض‌ها صفرند (بدونِ NaN). جمعِ عرض‌ها هرگز
 * از ۱۰۰ فراتر نمی‌رود (چون دسته‌ها ناهم‌پوشان‌اند و جمعِشان ≤ کل).
 */
export function buildFunnelSegments(funnel: ApplicationFunnel): FunnelSegment[] {
  const total = funnel.total;
  return FUNNEL_ORDER.map((key) => {
    const count = funnel[key];
    const pct = total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
    return { key, count, pct, ...CATEGORY_META[key] };
  });
}
