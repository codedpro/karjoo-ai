import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeSwitch } from "@/components/theme";
import { LedgerPanel } from "@/components/site-ledger-panel";
import { KARJOO_EXTENSION_DOWNLOAD_PATH } from "@/lib/extension/version";
import { publicProviderCapabilities } from "@/lib/apply/registry";
import { MAX_PROVIDER_SYNC_AGE_DAYS } from "@/lib/apply/freshness";
import { site } from "@/lib/site";

/**
 * Landing — «شیفت شب» / Night-Shift Console.
 *
 * Same editorial system as 1xAi (night surfaces, bone text, a single persimmon
 * accent, hairline rules, sharp corners on desktop, mono trackers). Everything is
 * a theme token, so the page follows the dark/light switch in the footer. No
 * gradient orbs, no bg-clip-text, no glow. Real, verifiable stats only — no
 * vanity user counts.
 */

/** Persian-digit helper for the few structural numerals rendered inline. */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const toFa = (n: number | string) =>
  String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** Names of the supported boards, straight from the canonical brand list. */
const boardNames = site.boards.map((b) => b.name).join("، ");

/* Console panels for the "how it works" pipeline — the NEW filter-based flow. */
const pipeline = [
  {
    n: "۰۱",
    title: "ارائه‌دهنده‌ها را وصل کن",
    body: "حساب‌های کاریابی‌ات را به کارجو وصل کن تا شغل‌ها و وضعیت درخواست‌ها از یک جا دیده شوند.",
  },
  {
    n: "۰۲",
    title: "در یک Job Board بگرد",
    body: "عنوان، شهر، شرکت و ارائه‌دهنده را یک‌جا جست‌وجو کن؛ هر آگهی را در سایت اصلی باز کن یا از کارجو اقدام کن.",
  },
  {
    n: "۰۳",
    title: "اپلای و پیگیری کن",
    body: "کارجو درخواست را با حساب خودت ثبت می‌کند و وضعیت‌های برگشتی ارائه‌دهنده‌ها را در کارجو نگه می‌دارد.",
  },
];

const capabilities = [
  {
    k: "یک Job Board برای همه",
    v: "جست‌وجوی واحد",
    body: "آگهی‌های تازه‌ی ارائه‌دهنده‌ها در یک فهرست می‌آیند؛ با فیلترهای کارجو سریع‌تر به گزینه‌ی درست می‌رسی.",
  },
  {
    k: "اپلای از کارجو یا سایت اصلی",
    v: "دو مسیر روشن",
    body: "روی هر آگهی می‌توانی سایت اصلی را باز کنی یا وقتی ارائه‌دهنده کامل فعال است، از کارجو اپلای کنی.",
  },
  {
    k: "وضعیت درخواست‌ها برمی‌گردد",
    v: "تا همیشه در کارجو",
    body: "هر چیزی که کارجو قبلاً همگام کرده، در تاریخچه می‌ماند؛ همگام‌سازی‌های بعدی فقط تا ۴۵ روز عقب می‌روند.",
  },
  {
    k: "ارائه‌دهنده‌ها مرحله‌ای اضافه می‌شوند",
    v: "قابل اعتماد",
    body: "یک سایت فقط وقتی live می‌شود که جست‌وجو، همگام‌سازی وضعیت و اپلای از کارجو برایش کامل شده باشد.",
  },
];

// Real, structural stats only (no vanity user counts). The boards figure is
// derived from the same list rendered below, so the number can never drift from
// what the page actually shows. Category count is a conservative floor.
const stats = [
  { v: toFa(publicProviderCapabilities().length), k: "ارائه‌دهنده در نقشه‌ی راه" },
  { v: toFa(MAX_PROVIDER_SYNC_AGE_DAYS), k: "روز سقفِ واکشی" },
  { v: "چندمدلی", k: "GPT · Claude · Gemini" },
  { v: "یک‌جا", k: "جست‌وجو و اپلای" },
];

const faqs = [
  {
    q: "بدونِ هوشِ مصنوعی چطور کار می‌کند؟",
    a: "تو دسته‌ها و فیلترهای سایت را انتخاب می‌کنی و کارجو به همه‌ی آگهی‌های همان فیلتر اپلای می‌کند. هوشِ مصنوعی فقط یک فیلترِ اختیاریِ روی این جریان است.",
  },
  {
    q: "روی چه سایت‌هایی اپلای می‌کند؟",
    a: `${boardNames} — ارائه‌دهنده‌ها یکی‌یکی اضافه می‌شوند و فقط وقتی کامل‌اند live می‌شوند.`,
  },
  {
    q: "اطلاعاتم امن است؟",
    a: "اپلای‌ها فقط با اجازه‌ی خودت و با حسابِ خودت انجام می‌شود و همیشه زیرِ کنترلِ توست — هر زمان می‌توانی اتصال را قطع کنی.",
  },
  {
    q: "شروع رایگان است؟",
    a: "بله. اپلای فیلتری رایگان است؛ فیلترِ هوشمند (AI) یک افزودنیِ اختیاریِ پولی است.",
  },
];

export default function Home() {
  return (
    // پس‌زمینه از body می‌آید (night-900) تا دانه‌ی کاغذِ body::before رویش دیده شود.
    <div dir="rtl" className="min-h-dvh text-bone antialiased">
      {/* ───────── Header ───────── */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-night-900/85 backdrop-blur-xl supports-backdrop-filter:bg-night-900/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center" aria-label="کارجو — خانه">
            <Logo size={30} title="کارجو" className="text-bone" />
          </Link>
          <nav className="hidden items-center gap-7 font-mono text-[13px] text-bone-dim md:flex" dir="ltr">
            <Link href="#how" className="transition-colors hover:text-bone">how</Link>
            <Link href="#caps" className="transition-colors hover:text-bone">what</Link>
            <Link href="#boards" className="transition-colors hover:text-bone">boards</Link>
            <Link href="#extension" className="transition-colors hover:text-bone">extension</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-3 py-2 text-sm text-bone-soft transition-colors hover:text-bone">
              ورود
            </Link>
            <Link
              href="/login"
              className="focus-ring press bg-persimmon px-4 py-2 text-sm font-medium text-night-950 transition-colors hover:bg-persimmon-soft"
            >
              رایگان شروع کن
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ───────── Hero ───────── */}
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            {/* text (right in RTL) */}
            <div>
              <span
                className="tracker inline-flex items-center gap-2 border border-hairline px-3 py-1.5 text-bone-dim"
                dir="ltr"
              >
                <span className="dot-live" />
                karjoo · unified job board + apply engine
              </span>

              <h1 className="display-fa mt-6 text-balance text-4xl leading-[1.18] sm:text-6xl">
                همه‌ی سایت‌های کاریابی،
                <br />
                <span className="text-persimmon">در یک جای واحد.</span>
              </h1>

              <p className="mt-6 max-w-xl text-pretty text-[17px] leading-8 text-bone-soft">
                شغل‌ها را از ارائه‌دهنده‌های مختلف یک‌جا پیدا کن، در سایت اصلی باز کن یا با کارجو اپلای کن،
                و وضعیت درخواست‌ها را همان‌جا پیگیری کن.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="focus-ring press bg-persimmon px-7 py-3.5 text-center text-base font-medium text-night-950 transition-colors hover:bg-persimmon-soft"
                >
                  رایگان شروع کن
                </Link>
                <Link
                  href="#how"
                  className="focus-ring press border border-hairline-strong px-7 py-3.5 text-center text-base font-semibold text-bone transition-colors hover:border-persimmon hover:text-persimmon"
                >
                  چطور کار می‌کند؟
                </Link>
              </div>

              {/* real-stats mono strip */}
              <dl
                className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-hairline pt-6 text-[13px]"
              >
                {stats.map((s) => (
                  <div key={s.k} className="flex items-baseline gap-2">
                    <dt className="ltr-nums text-lg font-bold text-persimmon">{s.v}</dt>
                    <dd className="text-bone-dim">{s.k}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* console ledger (left in RTL) */}
            <div dir="ltr">
              <LedgerPanel />
              <p className="tracker-fa mt-3 text-center" dir="rtl">
                نمونه‌ای از کاری که کارجو شب‌ها انجام می‌دهد — برد · دسته · وضعیت · مدلِ نویسنده‌ی کاورلتر.
              </p>
            </div>
          </div>
        </section>

        {/* ───────── How it works ───────── */}
        <section id="how" className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="tracker text-bone-dim" dir="ltr">{"// how it works"}</p>
            <h2 className="display-fa mt-3 text-2xl sm:text-3xl">از جست‌وجو تا پیگیری، یک مسیر</h2>
            <div className="mt-10 grid gap-px overflow-hidden border border-hairline bg-night-600 md:grid-cols-3">
              {pipeline.map((s) => (
                <div key={s.n} className="bg-night-800 p-7">
                  <span className="ltr-nums font-mono text-3xl font-bold text-persimmon" dir="ltr">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-bone-dim">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Capabilities ───────── */}
        <section id="caps" className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="tracker text-bone-dim" dir="ltr">{"// what you get"}</p>
            <h2 className="display-fa mt-3 text-2xl sm:text-3xl">قابلیت‌هایی که واقعاً وقت می‌خرند</h2>
            <div className="mt-10 grid gap-px overflow-hidden border border-hairline bg-night-600 sm:grid-cols-2">
              {capabilities.map((c) => (
                <div key={c.k} className="bg-night-800 p-7">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-bone">{c.k}</h3>
                    <span className="shrink-0 border border-persimmon/40 px-2 py-0.5 text-[11px] text-persimmon">
                      {c.v}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-bone-dim">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Boards (source list) ───────── */}
        <section id="boards" className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="tracker text-bone-dim" dir="ltr">{"// integrated sources"}</p>
            <h2 className="display-fa mt-3 text-2xl sm:text-3xl">ارائه‌دهنده‌ها، مرحله‌ای و شفاف</h2>
            <ul className="mt-8 divide-y divide-hairline-soft overflow-hidden border border-hairline">
              {publicProviderCapabilities().map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-4 bg-night-800 px-5 py-4">
                  <span className="flex items-center gap-3">
                    <span className={b.workflowState === "live" ? "h-1.5 w-1.5 rounded-full bg-jade" : b.workflowState === "in_progress" ? "h-1.5 w-1.5 rounded-full bg-persimmon" : "h-1.5 w-1.5 rounded-full bg-night-500"} />
                    <span className="text-base font-bold">{b.displayName}</span>
                  </span>
                  <span className="ltr-nums shrink-0 font-mono text-xs text-bone-dim" dir="ltr">
                    {b.workflowState === "live" ? "live" : b.workflowState === "in_progress" ? "in progress" : "planned"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ───────── Extension ───────── */}
        <section id="extension" className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="tracker text-bone-dim" dir="ltr">{"// browser extension"}</p>
                <h2 className="display-fa mt-3 text-2xl leading-snug sm:text-3xl">
                  افزونه را نصب کن،
                  <br />
                  <span className="text-persimmon">اپلای در مرورگرِ خودت</span>
                </h2>
                <p className="mt-5 max-w-xl leading-8 text-bone-soft">
                  افزونه مستقیم در مرورگرِ تو اجرا می‌شود، ارائه‌دهنده‌ها را وصل می‌کند و اپلای‌ها را با حساب خودت جلو می‌برد.
                  مسیر سرور برای پلن‌های بالاتر، همین جریان را ۲۴ ساعته ادامه می‌دهد.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={KARJOO_EXTENSION_DOWNLOAD_PATH}
                    download
                    className="focus-ring press bg-persimmon px-7 py-3.5 text-center text-base font-medium text-night-950 transition-colors hover:bg-persimmon-soft"
                  >
                    دانلود افزونه
                  </a>
                  <Link
                    href="/dashboard/extension"
                    className="focus-ring press border border-hairline-strong px-7 py-3.5 text-center text-base font-semibold text-bone transition-colors hover:border-persimmon hover:text-persimmon"
                  >
                    راهنمای نصب
                  </Link>
                </div>
                <p className="mt-4 font-mono text-[11px] text-bone-dim" dir="ltr">
                  Chrome · Edge · Load unpacked
                </p>
              </div>

              {/* mini console preview */}
              <div dir="ltr" className="overflow-hidden border border-hairline bg-night-800">
                <div className="flex items-center justify-between border-b border-hairline bg-night-950 px-4 py-2.5">
                  <span className="font-mono text-xs text-bone-soft">karjoo — popup</span>
                  <span className="text-[11px] text-jade">● متصل</span>
                </div>
                <div className="space-y-2 p-4" dir="rtl">
                  <div className="flex items-center justify-between border border-hairline bg-night-950 px-3.5 py-3">
                    <span className="text-sm font-semibold">اپلای خودکار در مرورگر</span>
                    <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-persimmon">
                      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-night-900" />
                    </span>
                  </div>
                  {["وب و برنامه‌نویسی", "IT / DevOps", "پشتیبانی مشتریان"].map((c) => (
                    <div key={c} className="flex items-center justify-between bg-night-950 px-3.5 py-2.5 text-sm">
                      <span className="flex items-center gap-2 text-bone-soft">
                        <span className="text-jade">✓</span>
                        {c}
                      </span>
                      <span className="font-mono text-[11px] text-bone-dim" dir="ltr">queued</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ───────── FAQ (transcript) ───────── */}
        <section className="border-t border-hairline">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <p className="tracker text-bone-dim" dir="ltr">{"// faq"}</p>
            <h2 className="display-fa mt-3 text-2xl sm:text-3xl">سؤال‌های پرتکرار</h2>
            <div className="mt-8 space-y-3">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="group overflow-hidden border border-hairline bg-night-800 [&_summary]:cursor-pointer"
                >
                  <summary className="flex items-center justify-between gap-3 px-5 py-4 text-base font-bold marker:content-['']">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-persimmon" dir="ltr">{">"}</span>
                      {f.q}
                    </span>
                    <span className="font-mono text-bone-dim transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="border-t border-hairline px-5 py-4 text-sm leading-8 text-bone-dim">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── CTA ───────── */}
        <section className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-20 text-center">
            <h2 className="display-fa text-3xl leading-snug sm:text-4xl">
              امشب، بگذار کارجو <span className="text-persimmon">شیفتِ شب</span> را بگیرد.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-8 text-bone-soft">
              ارائه‌دهنده‌ها را وصل کن؛ کارجو شغل‌های تازه، اپلای و وضعیت‌ها را در یک مسیر نگه می‌دارد.
            </p>
            <div className="mt-8">
              <Link
                href="/login"
                className="focus-ring press inline-block bg-persimmon px-8 py-4 text-base font-medium text-night-950 transition-colors hover:bg-persimmon-soft"
              >
                ساخت حساب رایگان
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-3">
            <Logo variant="mark" size={24} className="text-bone" />
            <span className="font-mono text-xs text-bone-dim" dir="ltr">
              karjoo · {site.name}
            </span>
          </div>
          <div className="flex flex-col items-center gap-2 sm:items-end">
            <ThemeSwitch />
            <a
              href="https://1xai.ir"
              target="_blank"
              rel="noopener"
              className="text-[11px] text-bone-dim transition-colors hover:text-persimmon"
            >
              از خانواده‌ی <span className="font-mono">1xAi</span> ↗
            </a>
            <p className="tracker-fa">
              © ۱۴۰۵ — اپلای با نشستِ خودت · بدونِ دور زدنِ تشخیص
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
