/**
 * سیستمِ لوگوی کارجو (Karjoo AI) — SVGِ درون‌خطیِ تولیدی، تیز در هر اندازه، RTL-درست.
 *
 * فلسفه‌ی طراحی
 * ─────────────
 * نشان یک «بَجِ» گِردگوشه به رنگِ persimmon (تأکیدِ امضای 1xAi) است که مونوگرامِ «K»
 * (کارجو) و یک «جرقه» (نمادِ هوشِ مصنوعی + خودکارسازیِ اپلای) به رنگِ صفحه داخلش نشسته‌اند.
 * فرمِ بَج منظم و متعادل است و در اندازه‌ی فاوآیکن هم خوانا می‌ماند.
 *
 * قواعدِ پیاده‌سازی
 * ────────────────
 *   • رنگ‌ها توکن‌اند (`--color-persimmon` / `--color-night-900`)؛ پس نشان با تمِ تیره/روشن
 *     جابه‌جا می‌شود و K همیشه به رنگِ صفحه روی persimmon می‌نشیند. رنگِ متن (currentColor)
 *     فقط وردمارک را تمی می‌کند.
 *   • RTL-درست: چیدمان راست‌به‌چپ است (نشان سمتِ راست، سپس «کارجو»، سپس «AI»).
 *   • بدونِ وابستگی — فقط React؛ بدونِ گرادیان، پس به `id`ِ یکتا هم نیازی نیست.
 *
 * API
 * ───
 *   <Logo/>       — قفلِ کاملِ نشان + وردمارک (پیش‌فرض).
 *   <Brandmark/>  — فقط نشان (برای فاوآیکن/آواتار/جای تنگ).
 *   props: variant ('full' | 'mark')، size (ارتفاعِ px)، className، title، showAi.
 */
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
 * بَجِ برند — مربعِ گِردگوشه‌ی persimmon، مونوگرامِ «K» و یک جرقه بالا-راستِ حرف (نمادِ
 * AI/اتوماسیون) به رنگِ صفحه. fallbackها مقادیرِ تمِ تیره‌اند (اگر توکن‌ها در دسترس نبودند).
 */
function KarjooBadge() {
  const ink = "var(--color-night-900, #0d0a07)";
  return (
    <>
      {/* بَجِ گِردگوشه */}
      <rect x="4" y="4" width="56" height="56" rx="18" fill="var(--color-persimmon, #ff6b35)" />
      {/* مونوگرامِ K — ستون + دو بازو */}
      <path d="M23 15V49" stroke={ink} strokeWidth="6.5" strokeLinecap="round" />
      <path
        d="M43.5 15 27.5 32 43.5 49"
        fill="none"
        stroke={ink}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* جرقه — AI/اتوماسیون */}
      <circle cx="45.5" cy="13.5" r="4.6" fill={ink} />
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
      <KarjooBadge />
    </svg>
  );
}

/* ────────────────────────────  وردمارکِ «کارجو»  ─────────────────────────── */

/**
 * وردمارکِ «کارجو» به‌صورتِ متن (پشته‌ی فونتِ سیستمیِ `--font-sans`) با `currentColor`،
 * به‌علاوه‌ی نشانِ اختیاریِ «AI» به‌شکلِ چیپِ چهارگوشِ persimmon. اندازه‌ها نسبی (em) هستند تا با
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
          fontFamily: "inherit",
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
            fontFamily: "inherit",
            fontWeight: 700,
            fontSize: "0.34em",
            letterSpacing: "0.08em",
            lineHeight: 1,
            padding: "0.32em 0.55em",
            color: "var(--color-night-900, #0d0a07)",
            background: "var(--color-persimmon, #ff6b35)",
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
