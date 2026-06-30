/**
 * بذرکارِ کاتالوگِ مدل‌ها (catalog seeder) — با tsx اجرا می‌شود: `npm run db:seed`.
 *
 * چرا لازم است؟ migrationها فقط جدولِ `ai_model_catalog` را *می‌سازند* (DDL)، نه پر.
 * بدونِ این مرحله، روی یک دیتابیسِ تازه کاتالوگ خالی می‌ماند → مدل‌پیکر «مدلی نیست»
 * نشان می‌دهد و اولین فراخوانیِ پولی (resolveUserModel) شکست می‌خورد. این اسکریپت
 * کاتالوگ را پر می‌کند تا کاربر بتواند مدل انتخاب کند و metering قیمت داشته باشد.
 *
 * منبعِ داده: `syncModelCatalog` ابتدا تلاش می‌کند قیمتِ زنده را از گیت‌وی 1xai
 * (`{origin}/pricing`) بخواند؛ در هر خطا/خالی‌بودن به SEED_MODELS سقوط می‌کند — پس
 * کاتالوگ هرگز خالی نمی‌ماند (idempotent، upsert بر اساسِ modelId).
 *
 * مثلِ migrate.ts بیرون از Next اجرا می‌شود؛ env را خودش از .env.local/.env می‌خواند
 * و یک کلاینتِ postgresِ مستقلِ تک‌اتصالی می‌سازد (نه poolِ src/db/index.ts). برای آنکه
 * ماژول‌های "server-only" زیرِ tsx خطا ندهند، اسکریپت با شرطِ react-server اجرا می‌شود
 * (در اسکریپتِ npm: `tsx --conditions=react-server`).
 *
 * نکته‌ی ترتیبِ بارگذاری (مهم): ماژولِ `@/lib/billing/catalog-sync` به‌صورتِ گذرا
 * `@/lib/env` را import می‌کند که *در زمانِ بارگذاری* DATABASE_URL را اعتبارسنجی می‌کند.
 * چون importهای ایستا پیش از بدنه‌ی ماژول اجرا می‌شوند، اگر مستقیماً import شود env
 * پیش از خوانده‌شدنِ .env.local ارزیابی و خطا می‌دهد. پس ابتدا dotenv را بار می‌کنیم و
 * سپس catalog-sync را *به‌صورتِ پویا* import می‌کنیم تا env پس از پر شدنِ process.env
 * ارزیابی شود — دقیقاً مثلِ migrate.ts که هیچ ماژولِ env-داری را زود import نمی‌کند.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "dotenv";

import * as schema from "@/db/schema";

// اول .env.local (توسعه‌ی محلی)، سپس .env — بدون بازنویسیِ موجودها. باید *پیش از*
// importِ پویای catalog-sync اجرا شود تا env معتبر باشد.
config({ path: ".env.local" });
config({ path: ".env" });

/** origin گیت‌وی را از ONEXAI_BASE_URL می‌گیرد (حذفِ /v1 و اسلشِ پایانی) یا undefined. */
function gatewayOrigin(): string | undefined {
  const base = process.env.ONEXAI_BASE_URL;
  if (!base || base.trim() === "") return undefined;
  return base.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL تنظیم نشده است. نمونه: postgres://karjoo:karjoo@localhost:5432/karjoo",
    );
  }

  // importِ پویا — پس از بارگذاریِ dotenv (تا اعتبارسنجیِ env شکست نخورد).
  const { syncModelCatalog } = await import("@/lib/billing/catalog-sync");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("در حال همگام‌سازی/بذرکاریِ کاتالوگِ مدل‌ها ...");
  // db را تزریق می‌کنیم تا از همین کلاینتِ تک‌اتصالی استفاده شود (نه poolِ پیش‌فرض).
  // origin هم تزریق می‌شود تا اگر ONEXAI تنظیم نباشد، مستقیم به seed برود.
  const result = await syncModelCatalog(db, undefined, { origin: gatewayOrigin() });

  console.log(
    `کاتالوگ همگام شد (منبع: ${result.source === "live" ? "گیت‌وی زنده" : "بذرِ داخلی"}؛ ` +
      `${result.upserted} مدل upsert شد).`,
  );

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("بذرکاریِ کاتالوگ ناموفق بود:", err);
    process.exit(1);
  });
