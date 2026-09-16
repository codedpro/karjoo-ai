/**
 * پرایمیتیوهای طراحیِ داشبورد — سیستمِ اجزای ارائه‌ایِ مشترک (server-safe، بدونِ state).
 *
 * زبانِ بصری همان 1xAi است (web/components/ui/kit.tsx): گوشه‌های تیز روی دسکتاپ، خطوطِ
 * مویی، دکمه‌ی اصلیِ persimmon و تیترهای display-fa. رنگ‌ها فقط از توکن‌ها می‌آیند
 * (night/bone/persimmon/jade/amber/rose) تا در هر دو تمِ تیره و روشن درست بنشینند.
 *
 * همه‌چیز روی توکن‌های `globals.css` سوار است (رنگ/شعاع/سایه/حلقه‌ی تمرکز) تا کارت‌ها،
 * دکمه‌ها، نشان‌ها و حالت‌های خالی در همه‌ی صفحه‌های داشبورد *یکدست* بمانند. هیچ رازی،
 * هیچ I/O، هیچ importِ `server-only`؛ پس هم در Server و هم در Client component قابلِ
 * استفاده‌اند.
 *
 * قواعدِ RTL: از property‌های منطقی (ms-/me-/ps-/pe-/start/end) استفاده می‌کنیم تا
 * چیدمان در راست‌به‌چپ درست بنشیند. برچسب‌ها با `whitespace-nowrap`/`text-balance`
 * از شکستنِ زشتِ دو-خطی مصون می‌مانند.
 */
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";

/* ─────────────────────────────  کمک‌کننده‌ها  ─────────────────────────────── */

/** ترکیبِ نازکِ کلاس‌ها (بدونِ وابستگیِ خارجی) — falsy‌ها را حذف می‌کند. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** ارقامِ فارسی برای حسِ بومی — اعداد لاتین را به ۰۹ فارسی نگاشت می‌کند. */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/* ─────────────────────────────────  Card  ───────────────────────────────── */

interface CardProps {
  children: ReactNode;
  className?: string;
  /** بالشتکِ داخلی؛ خاموش کن اگر خودت چیدمانِ سفارشی می‌خواهی. پیش‌فرض: خیر (سازگاری). */
  padded?: boolean;
  /** حالتِ تعاملی: کارت به‌عنوان دکمه/لینک عمل می‌کند (هاور + برجستگیِ لبه). */
  interactive?: boolean;
}

/**
 * کارتِ پایه — قابِ border/card با سایه‌ی ملایمِ توکنی. `padded`/`interactive`
 * به‌جای انبوهِ boolean، فقط دو حالتِ پرکاربردند؛ بقیه با `className` ترکیب می‌شود.
 */
export function Card({
  children,
  className = "",
  padded = false,
  interactive = false,
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline-soft bg-card",
        padded && "p-5 sm:p-6",
        interactive &&
          "transition-colors duration-200 hover:border-persimmon/40 hover:bg-night-700",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────  عنوان‌ها/هدرِ صفحه  ──────────────────────────── */

/**
 * عنوانِ بخش با زیرعنوانِ اختیاری — `text-balance` روی عنوان و `text-pretty` روی
 * زیرعنوان تا متن‌ها هیچ‌وقت زشت دو-خطی نشوند.
 */
export function SectionHeading({
  title,
  subtitle,
  as: As = "h1",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** تگِ عنوان — صفحه‌ی اصلی h1، بخش‌های درونی h2/h3. */
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="max-w-2xl">
      <As className="display-fa text-balance text-2xl text-bone sm:text-3xl">
        {title}
      </As>
      {subtitle ? (
        <p className="mt-2 text-pretty text-sm leading-7 text-bone-dim">{subtitle}</p>
      ) : null}
    </div>
  );
}

/**
 * هدرِ صفحه — عنوان/زیرعنوانِ سمتِ راست + اکشن‌های اختیاریِ سمتِ چپ. در موبایل
 * روی‌هم می‌ریزد. استفاده در بالای هر صفحه‌ی داشبورد برای سلسله‌مراتبِ یکدست.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  as = "h1",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-hairline-soft pb-5 sm:flex-row sm:items-end sm:justify-between">
      <SectionHeading title={title} subtitle={subtitle} as={as} />
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────  Badge  ──────────────────────────────── */

type BadgeTone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: "bg-persimmon/8 text-persimmon ring-persimmon/35",
  accent: "bg-jade/8 text-jade ring-jade/35",
  muted: "bg-bone/5 text-bone-dim ring-hairline-strong",
  green: "bg-jade/8 text-jade ring-jade/35",
  amber: "bg-amber/8 text-amber ring-amber/35",
  rose: "bg-rose/8 text-rose ring-rose/35",
};

/**
 * نشانِ کوچکِ وضعیت/برچسب — چیپِ چهارگوشِ مویی به سبکِ 1xAi. `whitespace-nowrap` تا هیچ
 * برچسبی به خطِ دوم نشکند.
 */
export function Badge({
  children,
  tone = "muted",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────────────  Button  ─────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "focus-ring press inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // همان چهار لحنِ Button در 1xAi: persimmon پُر، خطیِ قوی، شبح، خطر.
  primary: "bg-persimmon text-night-950 hover:bg-persimmon-soft",
  secondary:
    "border border-hairline-strong text-bone-soft hover:border-persimmon/50 hover:text-bone",
  ghost: "text-bone-dim hover:bg-bone/5 hover:text-bone",
  danger: "border border-rose text-rose hover:bg-rose hover:text-night-950",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
): string {
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

/** دکمه‌ی استاندارد — همان زبانِ بصریِ همه‌ی اکشن‌ها (لمسِ فیزیکی روی :active). */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

/** همان دکمه ولی به‌صورتِ لینکِ Next — برای ناوبری (CTA به صفحه‌ی دیگر). */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ────────────────────────────────  StatCard  ────────────────────────────── */

type StatTone = "brand" | "accent" | "green" | "amber" | "muted";

const STAT_ICON_TONES: Record<StatTone, string> = {
  brand: "border-persimmon/40 text-persimmon",
  accent: "border-jade/40 text-jade",
  green: "border-jade/40 text-jade",
  amber: "border-amber/40 text-amber",
  muted: "border-hairline-strong text-bone-dim",
};

/**
 * کارتِ آمار — عدد (بزرگ، ارقامِ فارسی)، برچسب، و یک آیکن‌باکسِ رنگی. اگر `href`
 * بدهی، کلِ کارت لینک و تعاملی می‌شود. برچسب `text-pretty` است تا نشکند.
 *
 * `icon` یک ReactNode است — معمولاً یک آیکنِ lucide از `./icons` (نه ایموجی). رنگ از
 * لحنِ باکس (`currentColor`) می‌آید؛ پس آیکن را بدونِ کلاسِ رنگ بده تا با tone هماهنگ
 * شود، و اندازه‌اش را با className (پیشنهاد: `h-5 w-5`) بده.
 */
export function StatCard({
  icon,
  value,
  label,
  tone = "brand",
  href,
  hint,
}: {
  /** یک آیکنِ ReactNode (lucide) — تزئینی؛ باکس خودش aria-hidden است. */
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: StatTone;
  href?: string;
  hint?: string;
}) {
  const body = (
    <Card padded interactive={Boolean(href)} className="h-full">
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center border [&>svg]:h-5 [&>svg]:w-5",
            STAT_ICON_TONES[tone],
          )}
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="ltr-nums text-2xl font-extrabold leading-tight text-bone tabular-nums">
            {typeof value === "number" ? toFaDigits(value) : value}
          </div>
          <div className="text-pretty text-xs leading-5 text-bone-dim">{label}</div>
        </div>
      </div>
      {hint ? <p className="mt-3 text-xs text-whisper">{hint}</p> : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="focus-ring block">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ───────────────────────────────  ScoreRing  ────────────────────────────── */

/**
 * حلقه‌ی امتیازِ تطبیق (۰..۱ → درصد). با conic-gradient رندر می‌شود تا بدونِ SVG/JS
 * کار کند و در RTL هم درست بنشیند.
 */
export function ScoreRing({ score }: { score: number | null }) {
  const pct = Math.round(Math.min(1, Math.max(0, score ?? 0)) * 100);
  const tone =
    pct >= 75
      ? "var(--color-persimmon)"
      : pct >= 50
        ? "var(--color-jade)"
        : "var(--color-bone-dim)";
  return (
    <div
      className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(${tone} ${pct}%, var(--color-night-600) 0)`,
      }}
      role="img"
      aria-label={`امتیاز تطبیق ${toFaDigits(pct)} درصد`}
    >
      <div className="grid h-11 w-11 place-items-center rounded-full bg-card">
        <span className="ltr-nums text-sm font-bold">{toFaDigits(pct)}</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────  EmptyState  ────────────────────────────── */

/**
 * حالتِ خالی — وقتی هنوز داده‌ای نیست؛ با اکشنِ اختیاری برای پرکردنِ داده.
 *
 * `icon` یک ReactNode است — معمولاً یک آیکنِ lucide از `./icons` (نه ایموجی). پیش‌فرض
 * یک آیکنِ «صندوقِ خالی» (Inbox) است. باکس خودش aria-hidden است و رنگِ brand دارد؛ آیکن
 * را بدونِ کلاسِ رنگ بده تا از `currentColor` والد ارث ببرد.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className = "",
}: {
  /** یک آیکنِ ReactNode (lucide). اگر ندهی، آیکنِ پیش‌فرضِ «صندوقِ خالی». */
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center border-y border-hairline-soft px-6 py-14 text-center",
        className,
      )}
    >
      <div
        className="grid h-14 w-14 place-items-center border border-persimmon/40 text-persimmon [&>svg]:h-7 [&>svg]:w-7"
        aria-hidden
      >
        {icon ?? <Inbox strokeWidth={1.75} aria-hidden />}
      </div>
      <h3 className="display-fa mt-4 text-balance text-lg text-bone">{title}</h3>
      {body ? (
        <p className="mt-2 max-w-sm text-pretty text-sm leading-7 text-bone-dim">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/* ────────────────────────────────  Callout  ─────────────────────────────── */

type CalloutTone = "info" | "warn" | "success" | "danger";

const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: "border-persimmon/50 bg-persimmon/5 text-bone",
  warn: "border-saffron/70 bg-saffron/5 text-bone",
  success: "border-jade bg-jade/5 text-bone",
  danger: "border-rose bg-rose/5 text-bone",
};

const CALLOUT_ICON_TONES: Record<CalloutTone, string> = {
  info: "text-persimmon",
  warn: "text-amber",
  success: "text-jade",
  danger: "text-rose",
};

/**
 * یادداشتِ کوتاهِ درون‌صفحه — جایگزینِ پاراگراف‌های توضیحیِ بلند.
 *
 * قاعده‌ی محتوایی: یک جمله. اگر توضیح بیشتری لازم است، یعنی خودِ UI گویا نیست و باید
 * ساده شود، نه اینکه متنِ بیشتری اضافه شود.
 */
export function Callout({
  tone = "info",
  icon,
  title,
  children,
  action,
  className = "",
}: {
  tone?: CalloutTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 border-s-2 py-3 pe-4 ps-4",
        CALLOUT_TONES[tone],
        className,
      )}
    >
      {icon ? (
        <span
          className={cn("mt-0.5 [&>svg]:h-5 [&>svg]:w-5", CALLOUT_ICON_TONES[tone])}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        {children ? (
          <div className="text-pretty text-sm leading-6 text-bone-dim">{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ───────────────────────────────  TableFrame  ───────────────────────────── */

/**
 * قابِ جدولِ داده — کارتِ گرد با اسکرولِ افقیِ *مهارشده*.
 *
 * چرا لازم است؟ جدول‌های داشبورد `min-w-[…]` داشتند که از عرضِ ستونِ محتوا بیشتر بود،
 * پس *همیشه* افقی اسکرول می‌شدند. حالا: خودِ قاب اسکرول را می‌گیرد (نه کلِ صفحه) و
 * جدول در عرضِ موجود پخش می‌شود؛ `minWidth` فقط یک کفِ اختیاری برای موبایل است.
 * بیرون‌زدگیِ افقیِ کلِ صفحه هرگز اتفاق نمی‌افتد.
 */
export function TableFrame({
  children,
  minWidth,
  className = "",
}: {
  children: ReactNode;
  /** کفِ عرضِ جدول روی صفحه‌های باریک (مثلاً `"44rem"`). پیش‌فرض: بدونِ کف. */
  minWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-hairline-soft bg-card",
        className,
      )}
    >
      <div style={minWidth ? { minWidth } : undefined}>{children}</div>
    </div>
  );
}

/* ────────────────────────────────  Skeleton  ────────────────────────────── */

/**
 * اسکلتِ بارگذاری — با درخششِ ملایم (`.skeleton-shimmer`). پایه‌ی همه‌ی fallbackها.
 * برای هم‌شکل‌بودنِ fallback با محتوای واقعی، از واریانت‌های زیر استفاده کن.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "skeleton-shimmer bg-bone/[0.06]",
        className,
      )}
      aria-hidden
    />
  );
}

/** چند خطِ متن (پاراگراف/عنوان). آخرین خط کوتاه‌تر تا طبیعی به‌نظر برسد. */
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** اسکلتِ کارت — قابِ border/card با آواتار + دو خطِ متن (هم‌شکلِ کارتِ لیست/تطبیق). */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline-soft bg-card p-5",
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="h-8 w-16 shrink-0" />
      </div>
    </div>
  );
}

/** فهرستی از اسکلتِ کارت‌ها — برای بخش‌هایی که کارت‌ها را پشتِ‌سرِ‌هم می‌چینند. */
export function SkeletonList({
  rows = 3,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** اسکلتِ کارتِ آمار — هم‌شکلِ StatCard (آیکن‌باکس + عدد + برچسب). */
export function SkeletonStat({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline-soft bg-card p-5 sm:p-6",
        className,
      )}
      aria-hidden
    >
      <div className="flex items-center gap-4">
        <Skeleton className="h-11 w-11 shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

/**
 * اسکلتِ جدول — سرستون + چند ردیف. هم‌شکلِ جدول‌های داده (ناوگان/تراکنش‌ها) تا
 * fallback به‌جای بلاکِ خاکستری، *ساختارِ* جدول را تقلید کند.
 */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className = "",
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-hairline-soft bg-card",
        className,
      )}
      aria-hidden
    >
      {/* سرستون */}
      <div className="flex items-center gap-4 border-b border-hairline-soft bg-surface/60 px-5 py-3.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {/* ردیف‌ها */}
      <div className="divide-y divide-hairline-soft">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn("h-4 flex-1", c === 0 && "max-w-[40%]")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
