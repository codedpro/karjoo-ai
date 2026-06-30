/**
 * اجراگرِ گرنتِ ماهانه‌ی اعتبار (tsx) — WF3 تراکِ C.
 *
 * اجرا: `tsx --conditions=react-server src/scripts/grant-monthly.ts`
 * (یا اسکریپتِ npm `grant:monthly`). روی همه‌ی کاربرانِ واجدِ شرایط (پلنِ پولیِ فعال)
 * grantMonthlyCredits (مالکِ Foundation) را *ایدمپوتنت* صدا می‌زند: دو اجرا در همان ماه
 * دوبار اعتبار نمی‌دهد. تعدادِ granted/skipped/ineligible را لاگ می‌کند.
 *
 * ── درزِ کران (cron seam) ─────────────────────────────────────────────────
 * اسکجولرِ واقعی بعداً می‌آید. تا آن زمان یک کرانِ سیستمی باید این اسکریپت را *ماهانه*
 * اجرا کند (یا مسیرِ POST /api/internal/grant-credits را با هدرِ راز صدا بزند). نمونه:
 *   # ۰۰:۱۰ روزِ اولِ هر ماه
 *   10 0 1 * *  cd /path/to/karjoo-ai && npm run grant:monthly >> /var/log/karjoo-grant.log 2>&1
 * این اسکریپت *عمداً* خودش اسکجولر نمی‌سازد.
 *
 * مثلِ migrate.ts/seed-catalog.ts بیرون از Next اجرا می‌شود: env را خودش از
 * .env.local/.env می‌خواند و یک کلاینتِ postgresِ تک‌اتصالیِ مستقل می‌سازد (نه poolِ
 * src/db/index.ts). برای آنکه ماژول‌های "server-only" زیرِ tsx خطا ندهند با شرطِ
 * react-server اجرا می‌شود. ماژولِ env-دار (grant-runner) *پویا* import می‌شود تا env
 * پس از پر شدنِ process.env ارزیابی شود.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "dotenv";

import * as schema from "@/db/schema";

// اول .env.local سپس .env — بدونِ بازنویسیِ موجودها. باید *پیش از* importِ پویای
// grant-runner اجرا شود تا اعتبارسنجیِ env شکست نخورد.
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL تنظیم نشده است. نمونه: postgres://karjoo:karjoo@localhost:5432/karjoo",
    );
  }

  // importِ پویا — پس از بارگذاریِ dotenv (تا اعتبارسنجیِ env شکست نخورد).
  const { runMonthlyGrants } = await import("@/lib/billing/grant-runner");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("در حال اجرای گرنتِ ماهانه‌ی اعتبار ...");
  // db را تزریق می‌کنیم تا از همین کلاینتِ تک‌اتصالی استفاده شود (نه poolِ پیش‌فرض).
  const summary = await runMonthlyGrants({}, { db });

  console.log(
    `گرنتِ ماهانه تمام شد (ماه ${summary.period}):\n` +
      `  • بررسی‌شده: ${summary.scanned}\n` +
      `  • گرنتِ تازه: ${summary.granted} (جمع ${summary.totalGrantedToman.toLocaleString("fa-IR")} تومان)\n` +
      `  • ردشده (قبلاً این ماه): ${summary.skipped}\n` +
      `  • بی‌اعتبار (Free/legacy): ${summary.ineligible}\n` +
      `  • خطا: ${summary.errors}`,
  );

  await client.end();

  // اگر حینِ گرنتِ تک‌تک خطایی بود، با کدِ غیرصفر خارج شو تا کران آن را ببیند.
  if (summary.errors > 0) process.exitCode = 2;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("اجرای گرنتِ ماهانه ناموفق بود:", err);
    process.exit(1);
  });
