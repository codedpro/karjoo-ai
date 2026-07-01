/**
 * /brand — صفحه‌ی پیش‌نمایشِ عمومیِ سیستمِ لوگوی کارجو.
 *
 * سه کانسپتِ لوگو (پیش‌فرض + دو جایگزین) را کنارِ هم و روی «هر دو» زمینه‌ی روشن و تیره
 * نشان می‌دهد تا مالک بتواند مقایسه و انتخاب کند. هر کانسپت هم قفلِ کامل (نشان+وردمارک)
 * و هم فقط-نشان را در چند اندازه نشان می‌دهد.
 *
 * چرا توکن‌های تم به‌صورتِ inline روی پنل‌ها ست می‌شوند؟ چون <Logo/> رنگش را از
 * متغیرهای CSSِ صفحه می‌گیرد. برای دیدنِ «واقعیِ» حالتِ تیره بدونِ وابستگی به تمِ
 * سیستم‌عامل، پنلِ تیره توکن‌های سطح/متن را محلی override می‌کند (رنگ‌های برند ثابت
 * می‌مانند). این‌طور هر دو حالت هم‌زمان و درست دیده می‌شوند.
 *
 * صفحه عمومی و ساده است (RSC، بدونِ 'use client').
 */
import type { Metadata } from "next";
import type { CSSProperties } from "react";

import {
  Brandmark,
  LOGO_CONCEPTS,
  type LogoProps,
} from "@/components/brand/logo";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "سیستمِ برند و لوگو",
  description:
    "پیش‌نمایشِ سه کانسپتِ لوگوی کارجو روی زمینه‌ی روشن و تیره — برای انتخابِ نشانِ نهایی.",
  robots: { index: false, follow: false },
};

/** توکن‌های تمِ روشن/تیره که محلی روی هر پنل ست می‌شوند (رنگ‌های برند ثابت‌اند). */
const LIGHT_VARS: CSSProperties = {
  ["--background" as string]: "#ffffff",
  ["--foreground" as string]: "#0b1220",
  ["--card" as string]: "#ffffff",
  ["--border" as string]: "#e7e8ee",
  ["--muted" as string]: "#64748b",
  ["--surface" as string]: "#f7f8fb",
};

const DARK_VARS: CSSProperties = {
  ["--background" as string]: "#070a13",
  ["--foreground" as string]: "#eef1f8",
  ["--card" as string]: "#0e1322",
  ["--border" as string]: "#1e2640",
  ["--muted" as string]: "#94a3b8",
  ["--surface" as string]: "#0a0f1c",
};

/** یک پنلِ تم‌بندی‌شده که نمونه‌های لوگو را روی آن رندر می‌کنیم. */
function ThemePanel({
  label,
  vars,
  Component,
}: {
  label: string;
  vars: CSSProperties;
  Component: (props: LogoProps) => React.ReactElement;
}) {
  return (
    <div
      style={{ ...vars, background: "var(--background)", color: "var(--foreground)" }}
      className="rounded-2xl border p-6"
    >
      <div className="mb-5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span
          className="ltr-nums rounded-full px-2 py-0.5 text-[0.65rem] font-medium text-muted"
          style={{ background: "var(--surface)" }}
        >
          currentColor + brand tokens
        </span>
      </div>

      {/* قفلِ کامل، سه اندازه */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
        <Component size={40} />
        <Component size={28} />
        <Component size={20} />
      </div>

      {/* فقط نشان + بدونِ چیپِ AI */}
      <div
        className="mt-6 flex flex-wrap items-center gap-8 border-t pt-6"
        style={{ borderColor: "var(--border)" }}
      >
        <Component variant="mark" size={44} />
        <Component variant="mark" size={28} />
        <Component showAi={false} size={26} />
      </div>
    </div>
  );
}

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      {/* سربرگ */}
      <header className="max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted">
          <span className="h-2 w-2 rounded-full bg-accent" />
          سیستمِ برند · {site.name}
        </span>
        <h1 className="mt-6 text-4xl font-extrabold leading-[1.3] sm:text-5xl">
          سه کانسپتِ لوگو،
          <br />
          <span className="bg-gradient-to-l from-brand to-brand-2 bg-clip-text text-transparent">
            یکی را انتخاب کن
          </span>
        </h1>
        <p className="mt-5 leading-8 text-muted">
          هر سه بر پایه‌ی مونوگرامِ هندسیِ «ک» و استعاره‌ی «جرقه/اتوماسیون» ساخته
          شده‌اند. هر کانسپت روی زمینه‌ی روشن و تیره، در چند اندازه، و به‌صورتِ
          قفلِ کامل و فقط-نشان نشان داده می‌شود.
        </p>
      </header>

      {/* گریدِ کانسپت‌ها */}
      <div className="mt-14 space-y-10">
        {LOGO_CONCEPTS.map((concept, i) => {
          const isDefault = i === 0;
          return (
            <section key={concept.id}>
              <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-xl font-bold">{concept.labelFa}</h2>
                <span className="ltr-nums text-sm font-medium text-muted">
                  {concept.name}
                </span>
                {isDefault ? (
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
                    پیش‌فرض
                  </span>
                ) : null}
              </div>
              <p className="mb-5 max-w-2xl text-sm leading-7 text-muted">
                {concept.description}
              </p>

              <div className="grid gap-5 lg:grid-cols-2">
                <ThemePanel
                  label="زمینه‌ی روشن"
                  vars={LIGHT_VARS}
                  Component={concept.Component}
                />
                <ThemePanel
                  label="زمینه‌ی تیره"
                  vars={DARK_VARS}
                  Component={concept.Component}
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* یادداشتِ فاوآیکن/OG */}
      <section className="mt-16 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="text-lg font-bold">فاوآیکن و تصویرِ اشتراک‌گذاری</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
          نشانِ کانسپتِ پیش‌فرض (KafSpark) به‌عنوانِ فاوآیکنِ اپ و روی تصویرِ Open
          Graph استفاده می‌شود. نمونه‌ی فاوآیکن (Brandmark) در چند اندازه:
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-8">
          <Brandmark size={64} />
          <Brandmark size={40} />
          <Brandmark size={24} />
          <Brandmark size={16} />
        </div>
      </section>
    </main>
  );
}
