import "server-only";

import { createClient } from "@itmaster/sdk";

import { site } from "@/lib/site";

/**
 * Server-only client for the IT Master content engine.
 *
 * کارجو محتوای وبلاگ/سئو خود را از موتور IT Master می‌کشد (Pull API). این کلاینت
 * فقط در سمت سرور اجرا می‌شود — کلید کشش (pull key) هرگز به مرورگر نمی‌رسد.
 *
 * Env (see .env.example):
 *   ITMASTER_API_URL   – engine origin, e.g. http://127.0.0.1:8088
 *   PUBLISH_SITE       – this site's TargetSite slug ("karjoo-ai")
 *   PUBLISH_PULL_KEY   – per-site bearer key (server only)
 */
export const itmaster = createClient({
  baseUrl: process.env.ITMASTER_API_URL ?? "",
  site: process.env.PUBLISH_SITE ?? "karjoo-ai",
  pullKey: process.env.PUBLISH_PULL_KEY ?? "",
  // ISR: refresh engine content every 5 min instead of hammering it per request.
  cache: 300,
});

/**
 * هرچه از موتورِ محتوا می‌آید را به دامنه‌ی خودمان بازنویسی می‌کند.
 *
 * موتورِ IT Master این سایت را با هاستِ خودش می‌شناسد (`karjooai.itmaster.uk`) و همان را
 * داخلِ خروجی‌هایش می‌گذارد: خطِ Sitemap در robots.txt، همه‌ی لینک‌های llms.txt و rss،
 * و موجودیت‌های WebSite/Organization در JSON-LD. کارجو اما زیرِ **`karjoo.1xai.ir`**
 * سرو می‌شود — عضوِ خانواده‌ی 1xAi. اگر بازنویسی نشود، گوگل و موتورهای AI به دامنه‌ای
 * ارجاع داده می‌شوند که سایتِ ما نیست (و آن URLها ۴۰۴ می‌دهند).
 *
 * عمداً روی *متن* کار می‌کند تا برای هر قالبِ خروجی (txt/xml/JSON-LD) یکسان عمل کند.
 */
const ENGINE_HOSTS = ["karjooai.itmaster.uk"] as const;

export function toKarjooHost(text: string): string {
  const target = site.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let out = text;
  for (const host of ENGINE_HOSTS) {
    out = out.split(host).join(target);
  }
  return out;
}
