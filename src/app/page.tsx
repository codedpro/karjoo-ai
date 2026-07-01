import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/site";

const features = [
  {
    icon: "🤖",
    title: "اپلای خودکار با هوش مصنوعی",
    body: "کارجو آگهی‌های مرتبط را پیدا می‌کند، انگیزه‌نامه‌ی اختصاصی می‌نویسد و به‌جای شما در سایت‌های کاریابی اپلای می‌کند.",
  },
  {
    icon: "🎯",
    title: "تطبیق هوشمند شغل",
    body: "بر اساس مهارت‌ها، سابقه و حقوق موردانتظار شما، فقط فرصت‌هایی که واقعاً مناسب‌اند انتخاب می‌شوند.",
  },
  {
    icon: "📝",
    title: "رزومه و کاورلتر هوشمند",
    body: "برای هر آگهی، رزومه و انگیزه‌نامه با کلمات کلیدی همان موقعیت شغلی بازنویسی و بهینه می‌شود.",
  },
  {
    icon: "📊",
    title: "داشبورد پیگیری",
    body: "وضعیت همه‌ی اپلای‌ها، بازدید کارفرما و دعوت به مصاحبه را یک‌جا و لحظه‌ای دنبال کنید.",
  },
  {
    icon: "🔔",
    title: "هشدار فرصت‌های تازه",
    body: "به‌محض انتشار آگهی متناسب با پروفایلتان، کارجو در همان دقایق اول برای شما اقدام می‌کند.",
  },
  {
    icon: "🔒",
    title: "حریم خصوصی شما",
    body: "اطلاعات و رزومه‌ی شما رمزنگاری می‌شود و هیچ‌گاه بدون اجازه‌ی شما جایی منتشر نمی‌شود.",
  },
];

const steps = [
  {
    n: "۱",
    title: "پروفایل بسازید",
    body: "رزومه را بارگذاری کنید یا با چند سؤال ساده، پروفایل حرفه‌ای‌تان را در چند دقیقه کامل کنید.",
  },
  {
    n: "۲",
    title: "ترجیحات را تعیین کنید",
    body: "عنوان شغلی، شهر، بازه‌ی حقوق و نوع همکاری دلخواه‌تان را مشخص کنید تا کارجو دقیق عمل کند.",
  },
  {
    n: "۳",
    title: "کارجو اپلای می‌کند",
    body: "هوش مصنوعی به‌صورت خودکار در جاب‌ویژن، جابینجا و بقیه‌ی سایت‌ها برای شما درخواست می‌فرستد.",
  },
];

const faqs = [
  {
    q: "کارجو در چه سایت‌هایی اپلای می‌کند؟",
    a: "در حال حاضر روی محبوب‌ترین سایت‌های کاریابی ایران مانند جاب‌ویژن، جابینجا، ای‌استخدام و کاربوم تمرکز داریم و فهرست به‌مرور گسترده‌تر می‌شود.",
  },
  {
    q: "آیا اطلاعاتم امن است؟",
    a: "بله. اطلاعات حساب و رزومه‌ی شما رمزنگاری‌شده ذخیره می‌شود و کنترل کامل روی اینکه برای چه آگهی‌هایی اپلای شود، در اختیار خودتان است.",
  },
  {
    q: "آیا اپلای‌ها واقعاً شخصی‌سازی می‌شوند؟",
    a: "بله. برای هر موقعیت، رزومه و انگیزه‌نامه با توجه به نیازمندی‌های همان آگهی بازنویسی می‌شود تا شانس دیده‌شدن شما بیشتر شود.",
  },
  {
    q: "شروع کار رایگان است؟",
    a: "بله، می‌توانید رایگان شروع کنید و چند اپلای نخست را آزمایش کنید؛ سپس بسته‌ی متناسب با نیازتان را انتخاب کنید.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        {/* ───────── Hero ───────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--brand)_18%,transparent),transparent)]"
          />
          <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 text-center sm:pt-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted">
              <span className="h-2 w-2 rounded-full bg-accent" />
              هوش مصنوعی، به‌جای ساعت‌ها جست‌وجوی شغل
            </span>

            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-extrabold leading-[1.25] tracking-tight sm:text-6xl sm:leading-[1.2]">
              کار رویایی‌ات را پیدا کن،
              <br />
              <span className="bg-gradient-to-l from-brand to-brand-2 bg-clip-text text-transparent">
                بقیه‌اش با کارجو
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-9 text-muted">
              {site.description}
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="w-full rounded-full bg-gradient-to-l from-brand to-brand-2 px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-brand/30 transition-transform hover:-translate-y-0.5 sm:w-auto"
              >
                رایگان شروع کن
              </Link>
              <Link
                href="#how"
                className="w-full rounded-full border border-border bg-card px-8 py-3.5 text-base font-semibold transition-colors hover:bg-foreground/5 sm:w-auto"
              >
                چطور کار می‌کند؟
              </Link>
            </div>

            <p className="mt-5 text-sm text-muted">
              بدون نیاز به کارت بانکی · در کمتر از <span className="ltr-nums">۵</span> دقیقه راه‌اندازی
            </p>

            {/* Stats */}
            <dl className="mx-auto mt-16 grid max-w-3xl grid-cols-3 gap-4">
              {[
                { v: "۱۰٪", k: "میانگین رشد نرخ پاسخ" },
                { v: "۵+", k: "سایت کاریابی" },
                { v: "۲۴/۷", k: "اپلای خودکار" },
              ].map((s) => (
                <div key={s.k} className="rounded-2xl border border-border bg-card p-5">
                  <dt className="ltr-nums bg-gradient-to-l from-brand to-brand-2 bg-clip-text text-3xl font-extrabold text-transparent">
                    {s.v}
                  </dt>
                  <dd className="mt-1 text-xs text-muted sm:text-sm">{s.k}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ───────── Features ───────── */}
        <section id="features" className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold sm:text-4xl">هر آنچه برای استخدام لازم داری</h2>
            <p className="mt-4 text-muted">یک دستیار هوشمند که فرایند کاریابی را از اول تا آخر برایت ساده می‌کند.</p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5"
              >
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-2xl">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-7 text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ───────── How it works ───────── */}
        <section id="how" className="border-y border-border/70 bg-card/40">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold sm:text-4xl">در سه قدم ساده</h2>
              <p className="mt-4 text-muted">از ثبت‌نام تا اولین اپلای، فقط چند دقیقه فاصله است.</p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {steps.map((s) => (
                <div key={s.n} className="relative rounded-2xl border border-border bg-card p-7">
                  <span className="ltr-nums grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-lg font-extrabold text-white">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── Supported boards ───────── */}
        <section id="boards" className="mx-auto max-w-6xl px-5 py-20 text-center">
          <h2 className="text-3xl font-extrabold sm:text-4xl">روی سایت‌های کاریابی ایران</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            کارجو با محبوب‌ترین پلتفرم‌های کاریابی کشور یکپارچه می‌شود.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {site.boards.map((b) => (
              <div
                key={b.en}
                className="rounded-2xl border border-border bg-card px-6 py-4 text-lg font-bold transition-colors hover:border-brand/40"
              >
                {b.name}
                <span className="ltr-nums mr-2 text-xs font-normal text-muted">{b.en}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ───────── FAQ ───────── */}
        <section className="border-t border-border/70 bg-card/40">
          <div className="mx-auto max-w-3xl px-5 py-20">
            <h2 className="text-center text-3xl font-extrabold sm:text-4xl">سؤال‌های پرتکرار</h2>
            <div className="mt-10 space-y-4">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-2xl border border-border bg-card p-5 [&_summary]:cursor-pointer"
                >
                  <summary className="flex items-center justify-between text-base font-bold marker:content-['']">
                    {f.q}
                    <span className="text-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-7 text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ───────── CTA ───────── */}
        <section id="cta" className="mx-auto max-w-6xl px-5 py-20">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-l from-brand to-brand-2 px-6 py-16 text-center text-white sm:px-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_60%_at_80%_20%,rgba(255,255,255,0.18),transparent)]"
            />
            <h2 className="relative text-3xl font-extrabold sm:text-4xl">امروز اولین اپلای هوشمندت را بزن</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-white/90">
              رایگان شروع کن و بگذار هوش مصنوعی کارجو، کار پیداکردن شغل را برایت انجام دهد.
            </p>
            <div className="relative mt-8">
              <Link
                href="/login"
                className="inline-block rounded-full bg-white px-8 py-3.5 text-base font-bold text-brand shadow-lg transition-transform hover:-translate-y-0.5"
              >
                ساخت حساب رایگان
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
