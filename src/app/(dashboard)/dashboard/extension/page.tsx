/**
 * صفحه‌ی «افزونه‌ی مرورگر» (Server component) — دانلود، نصب و اتصالِ افزونه‌ی کارجو.
 *
 * الگوی Next 16 (پوسته‌ی فوری): پوسته/هدر در `dashboard/layout.tsx` استاتیک است؛ این صفحه
 * فقط محتوا می‌دهد و هدرِ خودش را با `PageHeader` بی‌درنگ می‌آورد. محتوا تماماً استاتیک است
 * (راهنما + دکمه‌ی دانلود)، پس Suspense لازم نیست؛ تنها پنلِ اتصال و فهرستِ دستگاه‌ها client‌اند.
 *
 * تصمیم‌های محتوایی (بازنویسیِ ضدِ دیوارِ متن):
 *   • **یک** دکمه‌ی دانلودِ آشکار (در هدر). پیش‌تر دو دکمه‌ی یکسان بود و کاربر را مردد می‌کرد.
 *   • مراحلِ کروم و اِج تقریباً یکسان‌اند؛ نمایشِ هم‌زمانِ هر دو یعنی ۱۲ گام برای کاری که ۶ گام
 *     است. حالا هر مرورگر یک `<details>` است و با `name` مشترک، آکاردئونِ *انحصاری* می‌سازند
 *     (باز شدنِ یکی دیگری را می‌بندد) — بدونِ ذره‌ای JS و بدونِ client component. کروم پیش‌فرض
 *     باز است چون سهمِ غالبِ کاربران است.
 *   • روشِ توزیع «بارگذاریِ باز» است (تصمیمِ بیرونی، اینجا قابلِ تغییر نیست)؛ پس تنها کارِ ما
 *     زنده‌نگه‌داشتنِ کاربرِ غیرِفنی است: هر گام یک جمله‌ی امری، و هشدارِ حیاتیِ «پوشه را پاک
 *     نکنید» به‌جای پاراگرافِ دفن‌شده، یک `Callout` در بالای راهنما.
 *   • هر جمله‌ای که «دستور» نبود حذف شد؛ توضیحِ ارزشِ افزونه در زیرعنوانِ صفحه خلاصه است.
 *
 * `PairExtensionPanel` عمداً هم اینجا و هم در خانه‌ی داشبورد (آنبوردینگ) رندر می‌شود؛ در این
 * صفحه فقط *یک‌بار* می‌آید.
 *
 * حضورِ نشست پیش‌تر در `proxy.ts` (لبه، بدونِ DB) چک شده؛ اینجا فقط برای اطمینان دوباره
 * راستی‌آزمایی می‌کنیم و در نبودِ نشست به /login می‌رویم. فارسی/RTL؛ آیکن‌های lucide.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { getDashboardUser } from "@/components/dashboard/session";
import {
  ConnectedDevicesPanel,
  PairExtensionPanel,
} from "@/components/dashboard/pair-extension-panel";
import { BoardCredentialsPanel } from "@/components/dashboard/board-credentials-panel";
import { readCredentialPanelData } from "@/components/dashboard/board-credentials-data";
import {
  IconBolt,
  IconDownload,
  IconShield,
  IconSparkle,
  IconWarn,
} from "@/components/dashboard/icons";
import {
  Badge,
  Callout,
  Card,
  PageHeader,
  toFaDigits,
} from "@/components/dashboard/ui";
import {
  KARJOO_EXTENSION_DOWNLOAD_PATH,
  KARJOO_EXTENSION_VERSION,
} from "@/lib/extension/version";

// راستی‌آزماییِ نشست → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "افزونه‌ی مرورگر",
  robots: { index: false, follow: false },
};

/** آدرسِ فایلِ افزونه در public — دانلودِ یک‌کلیکی. */
const EXTENSION_ZIP = KARJOO_EXTENSION_DOWNLOAD_PATH;

export default async function ExtensionPage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");
  const credentialData = await readCredentialPanelData(user.userId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="افزونه‌ی مرورگر"
        subtitle="افزونه در مرورگرِ خودتان نصب می‌شود و اپلای در سایت‌های کاریابی را برایتان انجام می‌دهد. سه کار: دانلود، نصب، اتصال."
        actions={<DownloadButton />}
      />

      <Callout
        tone="warn"
        icon={<IconWarn />}
        title="پوشه‌ی افزونه را پاک یا جابه‌جا نکنید"
      >
        مرورگر افزونه را هر بار از همان پوشه می‌خواند؛ با حذف یا جابه‌جاییِ پوشه، افزونه از
        کار می‌افتد.
      </Callout>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <InstallGuide />
        </div>
        <div className="space-y-6">
          <PairExtensionPanel />
          <ConnectedDevicesPanel />
          <BoardCredentialsPanel {...credentialData} />
          <Callout tone="success" icon={<IconShield />} title="کنترل با شماست">
            افزونه فقط در مرورگرِ خودتان کار می‌کند و تاگلِ «اپلای خودکار» داخلِ خودش هر
            لحظه خاموش‌شدنی است.
          </Callout>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── دکمه‌ی دانلود ───────────────────────────── */

/**
 * تنها دکمه‌ی دانلودِ صفحه. لینکِ مستقیم به فایلِ استاتیکِ `public/` است (نه ناوبریِ
 * برنامه‌ای)، پس `<a download>` خام و نه `next/link`.
 */
function DownloadButton() {
  return (
    <a
      href={EXTENSION_ZIP}
      download
      className="focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-xs transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:brightness-110 active:translate-y-px"
    >
      <IconDownload className="h-4 w-4" />
      دانلودِ افزونه (ZIP)
    </a>
  );
}

/* ───────────────────────────── راهنمای نصب ───────────────────────────── */

/**
 * گام‌های نصبِ «بارگذاریِ باز» — هر گام دقیقاً یک جمله‌ی امری. کروم و اِج فقط در نشانیِ
 * صفحه‌ی افزونه‌ها فرق دارند؛ بقیه یکسان است. روی macOS و Windows تفاوتی نیست.
 */
const BROWSERS: Array<{
  id: string;
  name: string;
  tone: "brand" | "accent";
  defaultOpen: boolean;
  steps: string[];
}> = [
  {
    id: "chrome",
    name: "Google Chrome",
    tone: "brand",
    defaultOpen: true,
    steps: [
      "فایلِ karjoo-extension.zip را از حالتِ فشرده خارج کنید تا یک پوشه ساخته شود.",
      "در نوارِ آدرسِ کروم عبارتِ chrome://extensions را بنویسید و Enter بزنید.",
      "کلیدِ Developer mode را روشن کنید.",
      "روی Load unpacked کلیک کنید.",
      "همان پوشه‌ی گامِ یک را انتخاب کنید.",
      "آیکنِ کارجو را در نوارِ ابزارِ مرورگر سنجاق کنید.",
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    tone: "accent",
    defaultOpen: false,
    steps: [
      "فایلِ karjoo-extension.zip را از حالتِ فشرده خارج کنید تا یک پوشه ساخته شود.",
      "در نوارِ آدرسِ اِج عبارتِ edge://extensions را بنویسید و Enter بزنید.",
      "کلیدِ Developer mode را روشن کنید.",
      "روی Load unpacked کلیک کنید.",
      "همان پوشه‌ی گامِ یک را انتخاب کنید.",
      "آیکنِ کارجو را در نوارِ ابزارِ مرورگر سنجاق کنید.",
    ],
  },
];

function InstallGuide() {
  return (
    <Card padded className="h-full">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
          aria-hidden
        >
          <IconDownload className="h-5 w-5" />
        </span>
        <h2 className="text-base font-bold">نصب در ۶ گام</h2>
      </div>
      <p className="mt-1.5 text-sm leading-7 text-muted">
        مرورگرِ خود را انتخاب کنید؛ فقط گام‌های همان مرورگر را ببینید.
      </p>

      <div className="mt-5 space-y-3">
        {BROWSERS.map((b) => (
          <BrowserSteps key={b.id} {...b} />
        ))}
      </div>

      <VersionRow />
    </Card>
  );
}

/**
 * یک مرورگر = یک `<details>`. `name` مشترک ⇒ آکاردئونِ انحصاری (رفتارِ بومیِ HTML):
 * باز کردنِ یکی، دیگری را می‌بندد. در مرورگرهای قدیمی‌تر بدترین حالت این است که هر دو
 * باز بمانند — یعنی همان رفتارِ قبلی، نه خرابی.
 */
function BrowserSteps({
  name,
  steps,
  tone,
  defaultOpen,
}: {
  name: string;
  steps: string[];
  tone: "brand" | "accent";
  defaultOpen: boolean;
}) {
  return (
    <details
      name="karjoo-browser"
      open={defaultOpen}
      className="group rounded-xl border border-border bg-surface/40 open:bg-surface/70"
    >
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <Badge tone={tone}>{name}</Badge>
        <span className="text-muted">{toFaDigits(steps.length)} گام</span>
        <ChevronDown
          className="me-auto h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol className="space-y-3 border-t border-border/70 px-4 py-4">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className="ltr-nums grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand"
              aria-hidden
            >
              {toFaDigits(i + 1)}
            </span>
            <p className="text-pretty text-sm leading-7 text-foreground/90">
              {highlightCode(step)}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** نسخه‌ی منتشرشده — یک خط، چون افزونه خودش به‌روزرسانی را یادآوری می‌کند. */
function VersionRow() {
  return (
    <p className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-foreground/2 px-4 py-3 text-xs text-muted">
      <IconSparkle className="h-4 w-4 text-brand" aria-hidden />
      آخرین نسخه‌ی افزونه:
      <span
        dir="ltr"
        className="ltr-nums rounded-md bg-brand/10 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-brand"
      >
        v{KARJOO_EXTENSION_VERSION}
      </span>
      <IconBolt className="h-3.5 w-3.5" aria-hidden />
      برای به‌روزرسانی، نسخه‌ی تازه را دانلود و روی همان پوشه جایگزین کنید.
    </p>
  );
}

/* ───────────────────────────── کمک‌کننده‌های محلی ───────────────────────────── */

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
        className="mx-0.5 inline-block rounded-md bg-foreground/6 px-1.5 py-0.5 align-middle font-mono text-xs text-foreground"
      >
        {part}
      </code>
    ) : (
      part
    ),
  );
}
