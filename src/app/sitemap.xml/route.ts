import { itmaster } from "@/lib/itmaster";
import { site } from "@/lib/site";

/**
 * نقشه‌ی سایت — **خودمان** می‌سازیمش، نه proxy از موتورِ محتوا.
 *
 * چرا: `createSitemapRoute(itmaster)` صرفاً XMLِ خودِ موتور را عیناً پاس می‌داد و آن XML
 * دو مشکلِ کشنده داشت (هر دو زنده تأیید شد ۱۴۰۵/۰۵/۱۵):
 *   ۱) **هاستِ اشتباه** — موتور سایت را `karjooai.itmaster.uk` می‌شناسد، در حالی که سایت
 *      روی `NEXT_PUBLIC_SITE_URL` (karjoo.1xai.ir) سرو می‌شود.
 *   ۲) **مسیرِ اشتباه** — موتور `canonical_path` را بدونِ پیشوندِ `/blog` می‌دهد
 *      (`/my-slug`)، ولی مقاله‌ها فقط زیرِ `/blog/<slug>` سرو می‌شوند → ۴۰۴.
 * نتیجه: هر URLِ نقشه‌ی سایت ۴۰۴ می‌داد و عملاً هیچ مقاله‌ای قابلِ ایندکس نبود.
 *
 * حالا URLها را از روی همان اسلاگی می‌سازیم که واقعاً سرو می‌شود، با هاستِ خودِ سایت.
 * صفحه‌های ثابتِ عمومی هم اضافه می‌شوند. مسیرهای پشتِ لاگین (داشبورد) عمداً نیستند.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

/** صفحه‌های عمومیِ ثابت (بدونِ مسیرهای احرازشده). */
const STATIC_PATHS = ["/", "/blog", "/login"] as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function urlEntry(loc: string, lastmod?: string | null): string {
  const mod = lastmod ? `\n    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "";
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${mod}\n  </url>`;
}

export async function GET(): Promise<Response> {
  const base = site.url.replace(/\/$/, "");

  const entries: string[] = STATIC_PATHS.map((p) => urlEntry(`${base}${p === "/" ? "" : p}/`.replace(/\/$/, "") || `${base}/`));

  // مقالات — همیشه `/blog/<slug>` (همان مسیری که app router واقعاً سرو می‌کند).
  try {
    const posts = await itmaster.listArticles({ limit: 500 });
    for (const post of posts) {
      if (!post?.slug) continue;
      const lastmod =
        (post as { updated_at?: string | null; published_at?: string | null }).updated_at ??
        (post as { published_at?: string | null }).published_at ??
        null;
      entries.push(urlEntry(`${base}/blog/${post.slug}`, lastmod));
    }
  } catch {
    // موتورِ محتوا در دسترس نیست → نقشه‌ی سایتِ صفحاتِ ثابت بهتر از ۵۰۰ است.
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
