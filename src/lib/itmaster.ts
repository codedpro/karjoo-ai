import "server-only";

import { createClient } from "@itmaster/sdk";

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
