import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { LedgerPanel } from "@/components/site-ledger-panel";
import { site } from "@/lib/site";

/**
 * Landing — «شیفت شب» / Night-Shift Console.
 *
 * A deliberately self-contained, fixed "ink + amber" experience (NOT the app
 * theme tokens): the product is an operator that applies while you sleep, so the
 * marketing looks like its console. No gradient orbs, no bg-clip-text, no purple
 * glow. Monospace (system stack) for numerals / board slugs / codes; hairline
 * dividers; flat panels; a single "night-lamp" amber signal (#FFB020). Real,
 * verifiable stats only — no vanity user counts.
 */

const INK = "#0C0D10";

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
    title: "سایتت را وصل کن",
    body: "افزونه را نصب کن و با کدِ داشبورد در چند ثانیه به حسابِ کارجو وصل شو — بدونِ ورودِ دوباره.",
  },
  {
    n: "۰۲",
    title: "فیلترها را انتخاب کن",
    body: "دسته‌های شغلی، شهر، نوعِ همکاری و مرتب‌سازی را از میانِ گزینه‌های خودِ سایت انتخاب کن. همین — بدونِ نیاز به هوشِ مصنوعی.",
  },
  {
    n: "۰۳",
    title: "کارجو به همه اپلای می‌کند",
    body: "کارجو همه‌ی آگهی‌های آن فیلتر را پیدا می‌کند و برایت اپلای می‌کند — در مرورگرِ خودت یا ۲۴ ساعته روی سرور.",
  },
];

const capabilities = [
  {
    k: "اپلای انبوهِ فیلتری",
    v: "پیش‌فرض، بدونِ AI",
    body: "دسته و فیلترهای سایت را انتخاب کن؛ کارجو به همه‌ی آن شغل‌ها اپلای می‌کند. ساده، شفاف و قابل‌کنترل.",
  },
  {
    k: "فیلترِ هوشمند (AI)",
    v: "افزودنیِ اختیاری",
    body: "اگر بخواهی، هوشِ مصنوعی فهرست را به متناسب‌ترین شغل‌ها باریک می‌کند. اختیاری، پولی، و هرگز الزامی نیست.",
  },
  {
    k: "اپلای با هویتِ خودت",
    v: "حسابِ خودت",
    body: "اپلای‌ها با حسابِ خودت روی سایت ثبت می‌شوند — درست مثلِ اینکه خودت اپلای کرده‌ای، با اجازه‌ی تو و زیرِ کنترلِ کامل.",
  },
  {
    k: "تأییدِ نهایی با تو",
    v: "کنترلِ کامل",
    body: "فرم خودکار پر می‌شود، اما ارسالِ نهایی فقط با کلیکِ تو ثبت می‌شود. سقفِ روزانه و تاریخچه‌ی کامل.",
  },
];

// Real, structural stats only (no vanity user counts). The boards figure is
// derived from the same list rendered below, so the number can never drift from
// what the page actually shows. Category count is a conservative floor.
const stats = [
  { v: toFa(site.boards.length), k: "سایتِ کاریابی" },
  { v: "۲۰+", k: "دسته‌ی شغلیِ جابینجا" },
  { v: "چندمدلی", k: "GPT · Claude · Gemini" },
  { v: "۲۴/۷", k: "اپلای روی سرور" },
];

const faqs = [
  {
    q: "بدونِ هوشِ مصنوعی چطور کار می‌کند؟",
    a: "تو دسته‌ها و فیلترهای سایت را انتخاب می‌کنی و کارجو به همه‌ی آگهی‌های همان فیلتر اپلای می‌کند. هوشِ مصنوعی فقط یک فیلترِ اختیاریِ روی این جریان است.",
  },
  {
    q: "روی چه سایت‌هایی اپلای می‌کند؟",
    a: `${boardNames} — و فهرست به‌مرور گسترده‌تر می‌شود.`,
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
    <div
      dir="rtl"
      className="min-h-dvh font-[inherit] text-[#E8E9EC] antialiased"
      style={{ backgroundColor: INK }}
    >
      {/* barely-visible blueprint hairlines */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.4]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff0a 1px, transparent 1px), linear-gradient(to bottom, #ffffff0a 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* ───────── Header ───────── */}
      <header className="sticky top-0 z-20 border-b border-[#242832]/80 bg-[#0C0D10]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center" aria-label="کارجو — خانه">
            <Logo size={30} title="کارجو" className="text-[#E8E9EC]" />
          </Link>
          <nav className="hidden items-center gap-7 font-mono text-[13px] text-[#8A9099] md:flex" dir="ltr">
            <Link href="#how" className="transition-colors hover:text-[#E8E9EC]">how</Link>
            <Link href="#caps" className="transition-colors hover:text-[#E8E9EC]">what</Link>
            <Link href="#boards" className="transition-colors hover:text-[#E8E9EC]">boards</Link>
            <Link href="#extension" className="transition-colors hover:text-[#E8E9EC]">extension</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-3 py-2 text-sm text-[#c9cdd4] transition-colors hover:text-white">
              ورود
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-[#FFB020] px-4 py-2 text-sm font-bold text-[#0C0D10] transition-transform hover:-translate-y-px"
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
                className="inline-flex items-center gap-2 rounded-full border border-[#242832] bg-[#14161B] px-3 py-1 font-mono text-[11px] text-[#8A9099]"
                dir="ltr"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#FFB020]" />
                karjoo · night-shift apply engine
              </span>

              <h1 className="mt-6 text-balance text-4xl font-extrabold leading-[1.18] tracking-tight sm:text-6xl">
                تو می‌خوابی،
                <br />
                <span className="text-[#FFB020]">کارجو اپلای می‌کند.</span>
              </h1>

              <p className="mt-6 max-w-xl text-pretty text-[17px] leading-8 text-[#a7adb8]">
                دسته و فیلترهای سایت‌های کاریابی را انتخاب کن؛ کارجو همه‌ی آن شغل‌ها را پیدا می‌کند و
                برایت اپلای می‌کند — شبانه‌روز، با نشستِ خودت. هوشِ مصنوعی فقط یک افزودنیِ اختیاری است.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="rounded-md bg-[#FFB020] px-7 py-3.5 text-center text-base font-bold text-[#0C0D10] transition-transform hover:-translate-y-0.5"
                >
                  رایگان شروع کن
                </Link>
                <Link
                  href="#how"
                  className="rounded-md border border-[#2a2f3a] bg-[#14161B] px-7 py-3.5 text-center text-base font-semibold text-[#E8E9EC] transition-colors hover:border-[#3a4150]"
                >
                  چطور کار می‌کند؟
                </Link>
              </div>

              {/* real-stats mono strip */}
              <dl
                className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[#242832] pt-6 font-mono text-[13px]"
                dir="ltr"
              >
                {stats.map((s) => (
                  <div key={s.k} className="flex items-baseline gap-2">
                    <dt className="ltr-nums text-lg font-bold text-[#FFB020]">{s.v}</dt>
                    <dd className="text-[#8A9099]">{s.k}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* console ledger (left in RTL) */}
            <div dir="ltr">
              <LedgerPanel />
              <p className="mt-3 text-center font-mono text-[11px] text-[#8A9099]" dir="rtl">
                نمونه‌ای از کاری که کارجو شب‌ها انجام می‌دهد — برد · دسته · وضعیت · مدلِ نویسنده‌ی کاورلتر.
              </p>
            </div>
          </div>
        </section>

        {/* ───────── How it works ───────── */}
        <section id="how" className="border-t border-[#242832]">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="font-mono text-xs text-[#8A9099]" dir="ltr">// how it works</p>
            <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">سه گام، بدونِ پیچیدگی</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[#242832] bg-[#242832] md:grid-cols-3">
              {pipeline.map((s) => (
                <div key={s.n} className="bg-[#14161B] p-7">
                  <span className="ltr-nums font-mono text-3xl font-bold text-[#FFB020]" dir="ltr">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-[#8A9099]">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Capabilities ───────── */}
        <section id="caps" className="border-t border-[#242832]">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="font-mono text-xs text-[#8A9099]" dir="ltr">// what you get</p>
            <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">اپلای، آن‌طور که باید باشد</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[#242832] bg-[#242832] sm:grid-cols-2">
              {capabilities.map((c) => (
                <div key={c.k} className="bg-[#14161B] p-7">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-[#E8E9EC]">{c.k}</h3>
                    <span className="shrink-0 rounded-full border border-[#2a2f3a] px-2.5 py-0.5 font-mono text-[11px] text-[#FFB020]">
                      {c.v}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-[#8A9099]">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Boards (source list) ───────── */}
        <section id="boards" className="border-t border-[#242832]">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="font-mono text-xs text-[#8A9099]" dir="ltr">// integrated sources</p>
            <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">روی سایت‌های کاریابی ایران</h2>
            <ul className="mt-8 divide-y divide-[#1c1f27] overflow-hidden rounded-lg border border-[#242832]">
              {site.boards.map((b) => (
                <li key={b.en} className="flex items-center justify-between bg-[#14161B] px-5 py-4">
                  <span className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#37C08A]" />
                    <span className="text-base font-bold">{b.name}</span>
                  </span>
                  <span className="ltr-nums font-mono text-xs text-[#8A9099]" dir="ltr">
                    {b.en}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ───────── Extension ───────── */}
        <section id="extension" className="border-t border-[#242832]">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="font-mono text-xs text-[#8A9099]" dir="ltr">// browser extension</p>
                <h2 className="mt-2 text-2xl font-extrabold leading-snug sm:text-3xl">
                  افزونه را نصب کن،
                  <br />
                  <span className="text-[#FFB020]">اپلای در مرورگرِ خودت</span>
                </h2>
                <p className="mt-5 max-w-xl leading-8 text-[#a7adb8]">
                  افزونه مستقیم در مرورگرِ تو اجرا می‌شود و با نشستِ خودت به شغل‌های فیلترشده اپلای می‌کند.
                  اپلای خودکار در مرورگر، یا ۲۴ ساعته روی سرور (پلن‌های بالاتر).
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a
                    href="/karjoo-extension.zip"
                    download
                    className="rounded-md bg-[#FFB020] px-7 py-3.5 text-center text-base font-bold text-[#0C0D10] transition-transform hover:-translate-y-0.5"
                  >
                    دانلود افزونه
                  </a>
                  <Link
                    href="/dashboard/extension"
                    className="rounded-md border border-[#2a2f3a] bg-[#14161B] px-7 py-3.5 text-center text-base font-semibold transition-colors hover:border-[#3a4150]"
                  >
                    راهنمای نصب
                  </Link>
                </div>
                <p className="mt-4 font-mono text-[11px] text-[#8A9099]" dir="ltr">
                  Chrome · Edge · Load unpacked
                </p>
              </div>

              {/* mini console preview */}
              <div dir="ltr" className="overflow-hidden rounded-lg border border-[#242832] bg-[#14161B]">
                <div className="flex items-center justify-between border-b border-[#242832] bg-[#101217] px-4 py-2.5">
                  <span className="font-mono text-xs text-[#c9cdd4]">karjoo — popup</span>
                  <span className="font-mono text-[11px] text-[#37C08A]">● متصل</span>
                </div>
                <div className="space-y-2 p-4" dir="rtl">
                  <div className="flex items-center justify-between rounded-md border border-[#242832] bg-[#101217] px-3.5 py-3">
                    <span className="text-sm font-semibold">اپلای خودکار در مرورگر</span>
                    <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-[#FFB020]">
                      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-[#0C0D10]" />
                    </span>
                  </div>
                  {["وب و برنامه‌نویسی", "IT / DevOps", "پشتیبانی مشتریان"].map((c) => (
                    <div key={c} className="flex items-center justify-between rounded-md bg-[#101217] px-3.5 py-2.5 text-sm">
                      <span className="flex items-center gap-2 text-[#c9cdd4]">
                        <span className="text-[#37C08A]">✓</span>
                        {c}
                      </span>
                      <span className="font-mono text-[11px] text-[#8A9099]" dir="ltr">queued</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ───────── FAQ (transcript) ───────── */}
        <section className="border-t border-[#242832]">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <p className="font-mono text-xs text-[#8A9099]" dir="ltr">// faq</p>
            <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">سؤال‌های پرتکرار</h2>
            <div className="mt-8 space-y-3">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="group overflow-hidden rounded-lg border border-[#242832] bg-[#14161B] [&_summary]:cursor-pointer"
                >
                  <summary className="flex items-center justify-between gap-3 px-5 py-4 text-base font-bold marker:content-['']">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[#FFB020]" dir="ltr">{">"}</span>
                      {f.q}
                    </span>
                    <span className="font-mono text-[#8A9099] transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="border-t border-[#242832] px-5 py-4 text-sm leading-8 text-[#8A9099]">
                    {f.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── CTA ───────── */}
        <section className="border-t border-[#242832]">
          <div className="mx-auto max-w-6xl px-5 py-20 text-center">
            <h2 className="text-3xl font-extrabold sm:text-4xl">
              امشب، بگذار کارجو <span className="text-[#FFB020]">شیفتِ شب</span> را بگیرد.
            </h2>
            <p className="mx-auto mt-4 max-w-xl leading-8 text-[#a7adb8]">
              فیلترهایت را انتخاب کن و بخواب. صبح، فهرستِ اپلای‌ها منتظرت است.
            </p>
            <div className="mt-8">
              <Link
                href="/login"
                className="inline-block rounded-md bg-[#FFB020] px-8 py-4 text-base font-bold text-[#0C0D10] transition-transform hover:-translate-y-0.5"
              >
                ساخت حساب رایگان
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-[#242832]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-3">
            <Logo variant="mark" size={24} className="text-[#E8E9EC]" />
            <span className="font-mono text-xs text-[#8A9099]" dir="ltr">
              karjoo · {site.name}
            </span>
          </div>
          <p className="ltr-nums font-mono text-[11px] text-[#8A9099]" dir="ltr">
            © ۱۴۰۴ — اپلای با نشستِ خودت · بدونِ دور زدنِ تشخیص
          </p>
        </div>
      </footer>
    </div>
  );
}
