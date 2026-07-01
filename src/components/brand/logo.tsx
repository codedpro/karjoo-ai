/**
 * سیستمِ لوگوی کارجو (Karjoo AI) — SVGِ درون‌خطیِ تولیدی، تم‌پذیر و RTL-درست.
 *
 * فلسفه‌ی طراحی
 * ─────────────
 * «کارجو» = کار (job) + جو (seeker). محصول یک «اتوپایلوتِ» اپلای است؛ پس نشان باید هم
 * «حرفِ ک» را برساند و هم «جرقه/اتوماسیون» را. سه کانسپتِ متمایز ساخته‌ایم که همگی روی
 * یک مونوگرامِ هندسیِ «ک» بنا شده‌اند:
 *
 *   • KafSpark   (پیش‌فرض) — «ک» به‌صورتِ یک آبجکتِ هندسی که سرکشِ آن به یک «جرقه/بولت»
 *                 تبدیل می‌شود؛ نمادِ «کار + خودکارسازی». تمیزترین و متعادل‌ترین.
 *   • KafPin     — «ک» درونِ یک پینِ نقشه/قطره (نمادِ «پیدا کردنِ کار»)، با جرقه‌ی هسته.
 *   • KafOrbit   — «ک» با یک قوس/مدارِ اتوماسیون که یک ذره‌ی «اپلای» را دورش می‌چرخاند.
 *
 * قواعدِ پیاده‌سازی
 * ────────────────
 *   • همه‌چیز SVGِ درون‌خطی است (بدونِ رَستر). روی هر اندازه‌ای تیز می‌ماند.
 *   • تم‌پذیر: نشان از توکن‌های برند (`--brand`, `--brand-2`, `--accent`) و متن از
 *     `currentColor` استفاده می‌کند؛ پس روی زمینه‌ی روشن و تیره هر دو درست است.
 *   • RTL-درست: وردمارک «کارجو» به‌صورتِ متنِ SVG با `direction: rtl` رندر می‌شود و
 *     چیدمانِ کلی از منطقِ راست‌به‌چپِ صفحه پیروی می‌کند (نشان سمتِ راست، سپس متن).
 *   • بدونِ وابستگی — فقط React. `id`ها با `useId` یکتا می‌شوند تا چند لوگو در یک صفحه
 *     گرادیان‌هاشان تداخل نکند.
 *
 * API
 * ───
 *   <Logo/>       — قفلِ کاملِ نشان + وردمارک (کانسپتِ پیش‌فرض = KafSpark).
 *   <Brandmark/>  — فقط نشان (برای فاوآیکن/آواتار/جای تنگ).
 *   props مشترک: variant ('full' | 'mark')، size، className، title، و برای وردمارک
 *   showAi (نمایشِ «AI»).
 */
import { useId } from "react";

/* ────────────────────────────────  انواعِ مشترک  ─────────────────────────── */

/** حالتِ نمایشِ لوگو: قفلِ کامل (نشان+متن) یا فقط نشان. */
export type LogoVariant = "full" | "mark";

/** پراپ‌های مشترکِ همه‌ی لوگوها. */
export interface LogoProps {
  /** 'full' = نشان + وردمارک، 'mark' = فقط نشان. پیش‌فرض 'full'. */
  variant?: LogoVariant;
  /**
   * ارتفاعِ لوگو بر حسبِ px (عرض به‌تناسب حساب می‌شود). پیش‌فرض ۳۲.
   * برای کنترلِ کامل از `className` (مثلاً `h-8 w-auto`) استفاده کنید.
   */
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

/** ابعادِ ثابتِ نشان در فضای مختصاتِ SVG (مربعِ ۴۸×۴۸). */
const MARK_BOX = 48;

/* ══════════════════════════════════════════════════════════════════════════
   کانسپت ۱ — KafSpark (پیش‌فرض): «ک» که سرکشش یک جرقه/بولتِ اتوماسیون می‌شود.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * نشانِ KafSpark — یک «کاسه‌ی» هندسیِ گِرد (بدنه‌ی «ک») که یک «بولتِ جرقه» از داخلش
 * برمی‌خیزد (سرکش + دندانه‌ی «ک» + استعاره‌ی خودکارسازی). گرادیانِ برند در بدنه، لهجه‌ی
 * فیروزه‌ای در جرقه.
 */
function KafSparkMark({ gradId, boltId }: { gradId: string; boltId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand, #5b3df5)" />
          <stop offset="1" stopColor="var(--brand-2, #8b5cf6)" />
        </linearGradient>
        <linearGradient id={boltId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent, #06b6d4)" />
          <stop offset="1" stopColor="#67e8f9" />
        </linearGradient>
      </defs>
      {/* بدنه‌ی گِردِ نشان — کاسه‌ی «ک»؛ گوشه‌های نرم، شکافِ سمتِ بالا-راست برای جرقه. */}
      <path
        d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20a19.9 19.9 0 0 0-1.06-6.44l-7.9 5.2A11.98 11.98 0 1 1 24 12c1.61 0 3.15.32 4.56.9l4.7-6.35A19.9 19.9 0 0 0 24 4Z"
        fill={`url(#${gradId})`}
      />
      {/* بولتِ جرقه — سرکشِ «ک» + استعاره‌ی اتوماسیون. از مرکز به بیرونِ بالا-راست. */}
      <path
        d="M25 15 21 26h5l-3 9 13-15h-6l6-8-11 3Z"
        fill={`url(#${boltId})`}
        stroke="var(--background, #fff)"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   کانسپت ۲ — KafPin: «ک» درونِ یک پینِ نقشه/قطره (پیدا کردنِ کار)، با جرقه‌ی هسته.
   ══════════════════════════════════════════════════════════════════════════ */

function KafPinMark({ gradId, sparkId }: { gradId: string; sparkId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="var(--brand-2, #8b5cf6)" />
          <stop offset="1" stopColor="var(--brand, #5b3df5)" />
        </linearGradient>
        <linearGradient id={sparkId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="var(--accent, #06b6d4)" />
        </linearGradient>
      </defs>
      {/* پینِ نقشه — نمادِ «پیدا کردنِ کار». نوکِ پایین، دایره‌ی بالا. */}
      <path
        d="M24 3c-9.389 0-17 7.163-17 16 0 6.6 4.2 12.6 10.2 18.2 2 1.9 3.9 3.6 5.3 5.2.8.9 2.2.9 3 0 1.4-1.6 3.3-3.3 5.3-5.2C36.8 31.6 41 25.6 41 19c0-8.837-7.611-16-17-16Z"
        fill={`url(#${gradId})`}
      />
      {/* جرقه‌ی هسته — «ک»/اتوماسیون در دلِ پین (منفی‌فضا با رنگِ زمینه). */}
      <path
        d="M25 10 20.5 21H25l-2.5 8L33 16.5h-5l4-6.5-7 0Z"
        fill={`url(#${sparkId})`}
        stroke="var(--background, #fff)"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   کانسپت ۳ — KafOrbit: «ک» + قوسِ مدارِ اتوماسیون که یک ذره‌ی «اپلای» دورش می‌چرخد.
   ══════════════════════════════════════════════════════════════════════════ */

function KafOrbitMark({ gradId, orbitId }: { gradId: string; orbitId: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand, #5b3df5)" />
          <stop offset="1" stopColor="var(--brand-2, #8b5cf6)" />
        </linearGradient>
        <linearGradient id={orbitId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent, #06b6d4)" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      {/* هسته‌ی گِرد — بدنه‌ی «ک». */}
      <circle cx="24" cy="24" r="13" fill={`url(#${gradId})`} />
      {/* جرقه‌ی «ک» داخلِ هسته (منفی‌فضا). */}
      <path
        d="M25 15.5 21.5 24H25l-2 7 9.5-10.5h-4.5l3.5-5-6.5 0Z"
        fill="var(--background, #fff)"
        stroke="none"
      />
      {/* قوسِ مدارِ اتوماسیون — نیم‌چرخشِ باز. */}
      <path
        d="M39.5 15.5A18 18 0 0 1 15 40.9"
        fill="none"
        stroke={`url(#${orbitId})`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* ذره‌ی «اپلای» روی مدار. */}
      <circle cx="15" cy="40.9" r="3.4" fill="var(--accent, #06b6d4)" />
    </>
  );
}

/* ────────────────────────────  وردمارکِ «کارجو»  ─────────────────────────── */

/**
 * وردمارکِ «کارجو» به‌صورتِ متنِ SVG با فونتِ اپ (وزیرمتن، از `--font-vazir`) و
 * `currentColor`؛ به‌علاوه‌ی نشانِ اختیاریِ «AI» به‌شکلِ یک چیپِ کوچکِ برند.
 *
 * چرا متنِ SVG (نه <text> رَستری یا مسیرِ ثابت)؟ تا با تمِ فعلی (رنگِ متن) هم‌رنگ شود،
 * روی هر زمینه‌ای بخواند، و در RTL درست بنشیند — بدونِ وابستگی به فونتِ امبد‌شده.
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
          fontSize: "1.05em",
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
            fontSize: "0.5em",
            letterSpacing: "0.06em",
            lineHeight: 1,
            padding: "0.28em 0.5em",
            borderRadius: "0.5em",
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

/* ───────────────────────────  رندرِ عمومیِ نشان  ──────────────────────────── */

type MarkKind = "spark" | "pin" | "orbit";

/** یک نشانِ تنها را در یک <svg>ِ مربعِ تم‌پذیر رندر می‌کند. */
function MarkSvg({
  kind,
  size,
  className,
  title,
}: {
  kind: MarkKind;
  size: number;
  className?: string;
  title: string;
}) {
  const uid = useId().replace(/:/g, "");
  const a = `${kind}-a-${uid}`;
  const b = `${kind}-b-${uid}`;
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
      {kind === "spark" ? <KafSparkMark gradId={a} boltId={b} /> : null}
      {kind === "pin" ? <KafPinMark gradId={a} sparkId={b} /> : null}
      {kind === "orbit" ? <KafOrbitMark gradId={a} orbitId={b} /> : null}
    </svg>
  );
}

/** قفلِ کاملِ (نشان + وردمارک) یک کانسپت را می‌سازد. */
function makeLogo(kind: MarkKind, defaultTitle: string) {
  function LogoConcept({
    variant = "full",
    size = 32,
    className,
    title = defaultTitle,
    showAi = true,
  }: LogoProps) {
    if (variant === "mark") {
      return (
        <MarkSvg kind={kind} size={size} className={className} title={title} />
      );
    }
    return (
      <span
        className={className}
        dir="rtl"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.55em",
          fontSize: size,
          lineHeight: 1,
        }}
      >
        <MarkSvg kind={kind} size={size} title={title} />
        <Wordmark showAi={showAi} />
      </span>
    );
  }
  LogoConcept.displayName = `Logo(${kind})`;
  return LogoConcept;
}

/* ─────────────────────────────  اکسپورت‌ها  ──────────────────────────────── */

/** لوگوی رسمیِ کارجو — «ک» + جرقه/بولتِ اتوماسیون (کانسپتِ KafSpark، انتخابِ نهایی). */
export const Logo = makeLogo("spark", "کارجو");

/**
 * فقط نشان (بدونِ وردمارک) — کانسپتِ پیش‌فرض. برای فاوآیکن‌درون‌اپ/آواتار/جای تنگ.
 * تم‌پذیر و مربع؛ روی روشن/تیره درست است.
 */
export function Brandmark({ size = 32, className, title = "کارجو" }: BrandmarkProps) {
  return <MarkSvg kind="spark" size={size} className={className} title={title} />;
}

export default Logo;
