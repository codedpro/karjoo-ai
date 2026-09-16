import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { headTagsFromConfig, type HeadTags } from "@itmaster/sdk/next";

import { AnalyticsProvider } from "@/components/providers/analytics-provider";
import { ThemeProvider } from "@/components/theme";
import { itmaster, toKarjooHost } from "@/lib/itmaster";
import { site } from "@/lib/site";
import "./globals.css";

// فونت: هیچ وب‌فونتی بارگذاری نمی‌شود (مثلِ 1xAi) — پشته‌ی فونتِ سیستمی در globals.css
// (`--font-sans`؛ اگر وزیرمتن روی دستگاه نصب باشد همان اول انتخاب می‌شود).

// رنگِ نوارِ وضعیت: پیش‌فرضِ تیره. برای تمِ روشن، ThemeMeta (components/theme.tsx) آن را
// پیش از رنگ‌آمیزی اصلاح می‌کند. "dark light": تیره ترجیح است، ولی سند نسخه‌ی روشن هم دارد.
export const viewport: Viewport = {
  themeColor: "#0d0a07", // --color-night-900 (هم‌گام با THEME_COLOR.dark در components/theme.tsx)
  colorScheme: "dark light",
};

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    type: "website",
    locale: "fa_IR",
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: site.url,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

type Strategy = "beforeInteractive" | "afterInteractive" | "lazyOnload" | "worker";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // تگ‌های هد (وریفیکیشن، آنالیتیکس، فاوآیکن) از داشبورد موتور IT Master.
  let head: HeadTags | null = null;
  if (itmaster.configured) {
    try {
      const config = await itmaster.config();
      // تگ‌های موتور هم هاستِ خودش را دارند (canonical/og:url/verification) — به دامنه‌ی
        // خودمان بازنویسی می‌شوند تا کلِ سایت زیرِ karjoo.1xai.ir یکدست بماند.
        if (config) head = JSON.parse(toKarjooHost(JSON.stringify(headTagsFromConfig(config)))) as HeadTags;
    } catch {
      // اگر موتور در دسترس نبود، صفحه باید همچنان رندر شود.
    }
  }

  return (
    // `dark` فقط مقدارِ پیش‌فرضِ سرور است؛ next-themes پیش از hydrate آن را با تمِ ذخیره‌شده
    // (dark/light) عوض می‌کند — suppressHydrationWarning فقط همین یک اختلافِ کلاس را می‌پوشاند.
    <html lang="fa" dir="rtl" className="dark h-full antialiased" suppressHydrationWarning>
      <head>
        {head?.metaTags.map((m, i) =>
          m.name ? <meta key={`m${i}`} name={m.name} content={m.content} /> : null,
        )}
        {head?.links.map((l, i) => (
          <link key={`l${i}`} rel={l.rel} href={l.href} />
        ))}
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </ThemeProvider>
        {head?.scripts.map((s, i) =>
          s.src ? (
            <Script key={`s${i}`} src={s.src} strategy={(s.strategy as Strategy) ?? "afterInteractive"} />
          ) : (
            <Script
              key={`s${i}`}
              id={`engine-script-${i}`}
              strategy={(s.strategy as Strategy) ?? "afterInteractive"}
              dangerouslySetInnerHTML={{ __html: s.innerHtml ?? "" }}
            />
          ),
        )}
      </body>
    </html>
  );
}
