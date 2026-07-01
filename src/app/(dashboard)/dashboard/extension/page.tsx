/**
 * صفحه‌ی «افزونه‌ی مرورگر» (Server component) — دریافت و نصبِ افزونه‌ی کارجو.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ استاتیکِ خودش را با `PageHeader` بی‌درنگ می‌آورد. محتوای این صفحه
 * تماماً استاتیک است (راهنمای نصب + دکمه‌ی دانلود)، پس نیازی به Suspense نیست؛ تنها پنلِ
 * «اتصالِ افزونه» تعاملی (client) است و کدِ یک‌بارمصرف را از سرور می‌گیرد.
 *
 * حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ این‌جا فقط برای اطمینان دوباره
 * راستی‌آزمایی می‌کنیم و در نبودِ نشست به /login می‌رویم. فارسی/RTL؛ آیکن‌های lucide.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDashboardUser } from "@/components/dashboard/session";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import {
  IconBolt,
  IconCheck,
  IconDownload,
  IconPuzzle,
  IconShield,
  IconSparkle,
} from "@/components/dashboard/icons";
import { Badge, Card, PageHeader } from "@/components/dashboard/ui";
import { KARJOO_EXTENSION_VERSION } from "@/lib/extension/version";

// راستی‌آزماییِ نشست → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "افزونه‌ی مرورگر",
  robots: { index: false, follow: false },
};

/** آدرسِ فایلِ افزونه در public — دانلودِ یک‌کلیکی. */
const EXTENSION_ZIP = "/karjoo-extension.zip";

export default async function ExtensionPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="افزونه‌ی مرورگر"
        subtitle="افزونه‌ی کارجو در مرورگرِ خودتان نصب می‌شود و با تأییدِ شما، اپلای در سایت‌های کاریابی را پیش‌نویس و ارسال می‌کند. در سه گام: دانلود، نصب، و اتصال به حسابتان."
        actions={
          <a
            href={EXTENSION_ZIP}
            download
            className="focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-l from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:opacity-95 active:translate-y-px"
          >
            <IconDownload className="h-4 w-4" />
            دانلودِ افزونه
          </a>
        }
      />

      <IntroSection />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <InstallGuide />
        </div>
        <div className="space-y-6">
          <PairExtensionPanel />
          <PrivacyNote />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── معرفی + دانلود ─────────────────────────── */

/** سه ویژگیِ کلیدیِ افزونه — آیکن + عنوان + توضیح. */
const FEATURES: Array<{
  icon: typeof IconBolt;
  title: string;
  body: string;
}> = [
  {
    icon: IconSparkle,
    title: "پیش‌نویسِ هوشمند",
    body: "افزونه فرم‌های اپلای را با اطلاعاتِ رزومه‌ی شما به‌صورتِ هوشمند پر می‌کند تا فقط تأیید کنید.",
  },
  {
    icon: IconBolt,
    title: "اپلای خودکار در مرورگر",
    body: "با فعال‌سازیِ تاگلِ داخلِ افزونه، اپلای روی فرصت‌های بالای آستانه در مرورگرِ خودتان انجام می‌شود.",
  },
  {
    icon: IconShield,
    title: "امن و مقید به شما",
    body: "افزونه با یک کدِ یک‌بارمصرف به حسابتان متصل می‌شود؛ نیازی به واردکردنِ دوباره‌ی رمز نیست.",
  },
];

function IntroSection() {
  return (
    <Card padded>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand"
            aria-hidden
          >
            <IconPuzzle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-balance text-lg font-bold">افزونه‌ی کارجو چه می‌کند؟</h2>
            <p className="mt-1.5 max-w-xl text-pretty text-sm leading-7 text-muted">
              افزونه در مرورگرِ Chrome یا Edge نصب می‌شود و روی سایت‌های کاریابیِ ایرانی
              (جابینجا، جاب‌ویژن، ای‌استخدام، ایران‌تلنت) اپلای را برایتان آماده می‌کند —
              حتی هنگامی که خودتان پای سیستم نیستید.
            </p>
          </div>
        </div>
        <a
          href={EXTENSION_ZIP}
          download
          className="focus-ring inline-flex shrink-0 items-center justify-center gap-2 self-start whitespace-nowrap rounded-full bg-gradient-to-l from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:opacity-95 active:translate-y-px"
        >
          <IconDownload className="h-4 w-4" />
          دانلودِ افزونه (ZIP)
        </a>
      </div>

      <div className="mt-6 grid gap-4 border-t border-border/70 pt-6 sm:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="flex items-start gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
                aria-hidden
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold">{f.title}</h3>
                <p className="mt-1 text-pretty text-xs leading-6 text-muted">{f.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────────────────────── راهنمای نصب ─────────────────────────── */

/**
 * مراحلِ نصبِ «بارگذاریِ باز» (Load unpacked) در کروم و اِج. این روش برای هر دو مرورگر و
 * روی macOS و Windows یکسان است؛ تفاوتِ کوچک فقط در «بازکردنِ فایلِ ZIP» است که در
 * زیرنویسِ گامِ اول توضیح داده شده.
 */
const CHROME_STEPS: string[] = [
  "فایلِ karjoo-extension.zip را که دانلود کردید، از حالتِ فشرده خارج کنید تا یک پوشه (folder) به‌دست آید.",
  "در نوارِ آدرسِ کروم عبارتِ chrome://extensions را تایپ کنید و Enter بزنید.",
  "گوشه‌ی بالای صفحه، کلیدِ «Developer mode» (حالتِ توسعه‌دهنده) را روشن کنید.",
  "روی «Load unpacked» (بارگذاریِ باز) کلیک کنید.",
  "پوشه‌ای که در گامِ اول از حالتِ فشرده خارج کردید را انتخاب کنید و تأیید کنید.",
  "افزونه‌ی کارجو در فهرست ظاهر می‌شود؛ آیکنِ آن را در نوارِ ابزارِ مرورگر سنجاق کنید.",
];

const EDGE_STEPS: string[] = [
  "فایلِ karjoo-extension.zip را از حالتِ فشرده خارج کنید تا یک پوشه (folder) به‌دست آید.",
  "در نوارِ آدرسِ اِج عبارتِ edge://extensions را تایپ کنید و Enter بزنید.",
  "گوشه‌ی سمتِ چپِ صفحه، کلیدِ «Developer mode» (حالتِ توسعه‌دهنده) را روشن کنید.",
  "روی «Load unpacked» (بارگذاریِ باز) کلیک کنید.",
  "همان پوشه‌ی خارج‌شده از فشرده را انتخاب کنید و تأیید کنید.",
  "افزونه‌ی کارجو نصب می‌شود؛ آیکنِ آن را در نوارِ ابزار سنجاق کنید.",
];

function InstallGuide() {
  return (
    <Card padded>
      <div className="flex items-center gap-2">
        <InstallBadge />
        <h2 className="text-base font-bold">راهنمای نصب</h2>
      </div>
      <p className="mt-1.5 text-pretty text-sm leading-7 text-muted">
        افزونه به‌روشِ «بارگذاریِ باز» از پوشه‌ی خارج‌شده از فایلِ ZIP نصب می‌شود. این روش
        روی <span className="font-medium text-foreground">macOS</span> و{" "}
        <span className="font-medium text-foreground">Windows</span> یکسان است؛ فقط نامِ
        صفحه‌ی تنظیماتِ افزونه‌ها در هر مرورگر متفاوت است.
      </p>

      <div className="mt-6 space-y-6">
        <BrowserSteps
          browser="Google Chrome"
          tone="brand"
          steps={CHROME_STEPS}
        />
        <div className="border-t border-border/70" />
        <BrowserSteps browser="Microsoft Edge" tone="accent" steps={EDGE_STEPS} />
      </div>

      <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
        <IconWarnLike />
        <p className="text-pretty text-xs leading-6 text-muted">
          پس از نصب، پوشه‌ی خارج‌شده را{" "}
          <span className="font-medium text-foreground">پاک نکنید و جابه‌جا نکنید</span>؛
          مرورگر افزونه را از همان مسیر می‌خواند. برای به‌روزرسانی، نسخه‌ی جدید را دانلود
          و از همان‌جا دوباره «Load unpacked» کنید.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-foreground/[0.02] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <IconSparkle className="h-4 w-4 text-brand" aria-hidden />
          <span>
            آخرین نسخه‌ی منتشرشده‌ی افزونه:{" "}
            <span
              dir="ltr"
              className="ltr-nums mx-0.5 inline-block rounded-md bg-brand/10 px-1.5 py-0.5 align-middle font-mono text-[0.7rem] font-semibold text-brand"
            >
              v{KARJOO_EXTENSION_VERSION}
            </span>
          </span>
        </div>
        <span className="text-[0.7rem] leading-5 text-muted">
          افزونه هنگام باز شدن، نسخه‌ی نصب‌شده را با این نسخه می‌سنجد و در صورتِ قدیمی بودن،
          پیامِ به‌روزرسانی نشان می‌دهد.
        </span>
      </div>
    </Card>
  );
}

function BrowserSteps({
  browser,
  steps,
  tone,
}: {
  browser: string;
  steps: string[];
  tone: "brand" | "accent";
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <Badge tone={tone}>{browser}</Badge>
        <span className="text-xs text-muted">macOS و Windows</span>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className="ltr-nums grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand"
              aria-hidden
            >
              {toFa(i + 1)}
            </span>
            <p className="text-pretty text-sm leading-7 text-foreground/90">
              {highlightCode(step)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────── یادداشتِ حریمِ خصوصی ─────────────────────────── */

function PrivacyNote() {
  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        >
          <IconCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold">با کنترلِ کامل شما</h3>
          <p className="mt-1 text-pretty text-sm leading-7 text-muted">
            افزونه فقط در مرورگرِ خودتان و با تأییدِ شما کار می‌کند. تاگلِ «اپلای خودکار در
            مرورگر» داخلِ خودِ افزونه است و هر لحظه قابلِ خاموش‌کردن است.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────── کمک‌کننده‌های محلی ─────────────────────────── */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function toFa(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/**
 * قطعه‌های شبیهِ آدرس/دستور (مثلِ chrome://extensions یا Load unpacked) را به‌صورتِ
 * inline-code با فونتِ mono و جهتِ چپ‌به‌راست نمایش می‌دهد تا در متنِ RTL خوانا بمانند.
 */
const CODE_TOKENS = [
  "chrome://extensions",
  "edge://extensions",
  "Load unpacked",
  "Developer mode",
  "karjoo-extension.zip",
];
function highlightCode(text: string) {
  const pattern = new RegExp(
    `(${CODE_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "g",
  );
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    CODE_TOKENS.includes(part) ? (
      <code
        key={i}
        dir="ltr"
        className="mx-0.5 inline-block rounded-md bg-foreground/[0.06] px-1.5 py-0.5 align-middle font-mono text-xs text-foreground"
      >
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function InstallBadge() {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
      aria-hidden
    >
      <IconDownload className="h-4 w-4" />
    </span>
  );
}

function IconWarnLike() {
  return (
    <span className="mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0"
      >
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.6 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      </svg>
    </span>
  );
}
