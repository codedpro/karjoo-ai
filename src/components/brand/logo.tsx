/**
 * سیستمِ لوگوی کارجو (Karjoo AI) — SVGِ درون‌خطیِ تولیدی، تیز در هر اندازه، RTL-درست.
 *
 * فلسفه‌ی طراحی
 * ─────────────
 * نشان یک «بَجِ» گِردگوشه با گرادیانِ برند است که مونوگرامِ «K» (کارجو) سفید داخلش نشسته،
 * به‌همراهِ یک «جرقه»ی فیروزه‌ای (نمادِ هوشِ مصنوعی + خودکارسازیِ اپلای). فرمِ بَج مثلِ
 * آیکنِ اپ‌های مدرن، منظم و متعادل است و در اندازه‌ی فاوآیکن هم خوانا می‌ماند.
 *
 * قواعدِ پیاده‌سازی
 * ────────────────
 *   • نشان یک بَجِ خودبسنده است (گرادیان + سفید + لهجه‌ی فیروزه‌ای): روی هر زمینه‌ای یکسان
 *     و درست دیده می‌شود؛ رنگِ متن (currentColor) فقط وردمارک را تمی می‌کند.
 *   • RTL-درست: چیدمان راست‌به‌چپ است (نشان سمتِ راست، سپس «کارجو»، سپس «AI»).
 *   • بدونِ وابستگی — فقط React. `id`ها با `useId` یکتا می‌شوند تا چند لوگو در یک صفحه
 *     گرادیان‌هاشان تداخل نکنند.
 *
 * API
 * ───
 *   <Logo/>       — قفلِ کاملِ نشان + وردمارک (پیش‌فرض).
 *   <Brandmark/>  — فقط نشان (برای فاوآیکن/آواتار/جای تنگ).
 *   props: variant ('full' | 'mark')، size (ارتفاعِ px)، className، title، showAi.
 */
import { useId } from "react";

/* ────────────────────────────────  انواعِ مشترک  ─────────────────────────── */

/** حالتِ نمایشِ لوگو: قفلِ کامل (نشان+متن) یا فقط نشان. */
export type LogoVariant = "full" | "mark";

/** پراپ‌های مشترکِ همه‌ی لوگوها. */
export interface LogoProps {
  /** 'full' = نشان + وردمارک، 'mark' = فقط نشان. پیش‌فرض 'full'. */
  variant?: LogoVariant;
  /** ارتفاعِ لوگو بر حسبِ px (عرض به‌تناسب). پیش‌فرض ۳۴. */
  size?: number;
  className?: string;
  /** عنوانِ دسترسی‌پذیری (a11y). پیش‌فرض «کارجو». برای حالتِ تزئینی رشته‌ی خالی بدهید. */
  title?: string;
  /** نمایشِ نشانِ «AI» کنارِ وردمارک (فقط در variant='full'). پیش‌فرض true. */
  showAi?: boolean;
}

/** پراپ‌های فقط-نشان (Brandmark). */
export interface BrandmarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/** ابعادِ نشان در فضای مختصاتِ SVG (مربعِ ۶۴×۶۴). */
const MARK_BOX = 64;

/* ─────────────────────────────  نشانِ کارجو (بَج)  ────────────────────────── */

/**
 * بَجِ برند — مربعِ گِردگوشه با گرادیانِ برند، مونوگرامِ «K»ِ سفید، و یک جرقه‌ی فیروزه‌ای
 * بالا-راستِ حرف (نمادِ AI/اتوماسیون). خودبسنده و ثابت‌رنگ تا روی هر زمینه‌ای درست بنشیند.
 */
function KarjooBadge({ gradId }: { gradId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand, #5b3df5)" />
          <stop offset="1" stopColor="var(--brand-2, #8b5cf6)" />
        </linearGradient>
      </defs>
      {/* بَجِ گِردگوشه */}
      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${gradId})`} />
      {/* مونوگرامِ K — ستون + دو بازو */}
      <path d="M23 15V49" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      <path
        d="M43.5 15 27.5 32 43.5 49"
        fill="none"
        stroke="#fff"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* جرقه‌ی فیروزه‌ای — AI/اتوماسیون */}
      <circle cx="45.5" cy="13.5" r="4.6" fill="var(--accent, #06b6d4)" />
    </>
  );
}

/** یک نشانِ تنها را در یک <svg>ِ مربع رندر می‌کند. */
function MarkSvg({
  size,
  className,
  title,
}: {
  size: number;
  className?: string;
  title: string;
}) {
  const uid = useId().replace(/:/g, "");
  const gradId = `karjoo-grad-${uid}`;
  const labelled = title.length > 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
      className={className}
      role={labelled ? "img" : "presentation"}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      {labelled ? <title>{title}</title> : null}
      <KarjooBadge gradId={gradId} />
    </svg>
  );
}

/* ────────────────────────────  وردمارکِ «کارجو»  ─────────────────────────── */

/**
 * وردمارکِ «کارجو» به‌صورتِ متن (فونتِ وزیرمتن از `--font-vazir`) با `currentColor`،
 * به‌علاوه‌ی نشانِ اختیاریِ «AI» به‌شکلِ چیپِ کوچکِ برند. اندازه‌ها نسبی (em) هستند تا با
 * `size`ِ لوگو مقیاس بخورند.
 */
function Wordmark({ showAi }: { showAi: boolean }) {
  return (
    <span
      dir="rtl"
      style={{ display: "inline-flex", alignItems: "center", gap: "0.4em" }}
    >
      <span
        style={{
          fontFamily: "var(--font-vazir, inherit)",
          fontWeight: 800,
          fontSize: "0.68em",
          letterSpacing: "-0.01em",
          lineHeight: 1,
          color: "currentColor",
        }}
      >
        کارجو
      </span>
      {showAi ? (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-vazir, inherit)",
            fontWeight: 700,
            fontSize: "0.34em",
            letterSpacing: "0.08em",
            lineHeight: 1,
            padding: "0.32em 0.55em",
            borderRadius: "0.55em",
            color: "#fff",
            background:
              "linear-gradient(135deg, var(--brand, #5b3df5), var(--brand-2, #8b5cf6))",
            direction: "ltr",
          }}
        >
          AI
        </span>
      ) : null}
    </span>
  );
}

/* ─────────────────────────────────  لوگو  ───────────────────────────────── */

/** لوگوی رسمیِ کارجو — بَجِ «K» + وردمارکِ «کارجو» + نشانِ «AI». */
export function Logo({
  variant = "full",
  size = 34,
  className,
  title = "کارجو",
  showAi = true,
}: LogoProps) {
  if (variant === "mark") {
    return <MarkSvg size={size} className={className} title={title} />;
  }
  return (
    <span
      className={className}
      dir="rtl"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.42em",
        fontSize: size,
        lineHeight: 1,
      }}
    >
      <MarkSvg size={size} title={title} />
      <Wordmark showAi={showAi} />
    </span>
  );
}

/**
 * فقط نشان (بدونِ وردمارک) — برای فاوآیکن‌درون‌اپ/آواتار/جای تنگ. مربع و خودبسنده.
 */
export function Brandmark({ size = 32, className, title = "کارجو" }: BrandmarkProps) {
  return <MarkSvg size={size} className={className} title={title} />;
}

export default Logo;
