import { itmaster, toKarjooHost } from "@/lib/itmaster";
import { site } from "@/lib/site";

/**
 * robots.txt — قواعد از داشبوردِ موتورِ محتوا می‌آید، ولی **دامنه از خودِ ماست**.
 *
 * چرا پروکسیِ خام کافی نیست: موتور این سایت را با هاستِ خودش (`karjooai.itmaster.uk`)
 * می‌شناسد، پس خطِ `Sitemap:` را به دامنه‌ای می‌داد که سایتِ ما نیست — یعنی خزنده‌ها
 * نقشه‌ی سایتِ کارجو را اصلاً پیدا نمی‌کردند. کارجو زیرِ `karjoo.1xai.ir` سرو می‌شود
 * (عضوِ خانواده‌ی 1xAi)، و همین‌جا تضمین می‌کنیم خطِ Sitemap همان باشد.
 *
 * اگر موتور در دسترس نبود، یک robots.txtِ امنِ پیش‌فرض می‌دهیم (بهتر از ۵۰۰).
 */
export const runtime = "nodejs";
export const revalidate = 3600;

const FALLBACK_DISALLOW = [
  "/api/",
  "/admin",
  "/dashboard",
  "/login",
  "/_next/",
];

function fallbackRobots(sitemapUrl: string): string {
  return [
    "User-agent: *",
    ...FALLBACK_DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
}

export async function GET(): Promise<Response> {
  const base = site.url.replace(/\/$/, "");
  const sitemapUrl = `${base}/sitemap.xml`;

  let body: string;
  try {
    const fromEngine = await itmaster.robots();
    if (fromEngine && fromEngine.trim().length > 0) {
      // ۱) هر ارجاع به هاستِ موتور → دامنه‌ی خودمان.
      let text = toKarjooHost(fromEngine);
      // ۲) خطِ Sitemap را قطعی می‌کنیم (اگر نبود، اضافه؛ اگر بود، به نقشه‌ی خودمان).
      text = /^\s*Sitemap:/im.test(text)
        ? text.replace(/^\s*Sitemap:.*$/gim, `Sitemap: ${sitemapUrl}`)
        : `${text.trimEnd()}\n\nSitemap: ${sitemapUrl}\n`;
      body = text;
    } else {
      body = fallbackRobots(sitemapUrl);
    }
  } catch {
    body = fallbackRobots(sitemapUrl);
  }

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
