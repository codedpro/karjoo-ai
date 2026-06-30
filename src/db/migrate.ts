/**
 * اجراگر مهاجرت (migration runner) — با tsx اجرا می‌شود: `npm run db:migrate`.
 *
 * این اسکریپت بیرون از Next اجرا می‌شود؛ پس متغیرها را خودش از .env.local / .env
 * می‌خواند و کلاینت postgres مستقل می‌سازد (نه از src/db/index.ts که server-only
 * است). مهاجرت‌ها از پوشه‌ی ./drizzle خوانده و اعمال می‌شوند.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { config } from "dotenv";

// اول .env.local (توسعه‌ی محلی)، سپس .env به‌عنوان پشتیبان — بدون بازنویسی موجودها.
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL تنظیم نشده است. نمونه: postgres://karjoo:karjoo@localhost:5432/karjoo",
    );
  }

  // برای مهاجرت یک اتصال کافی است.
  const migrationClient = postgres(url, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("در حال اعمال مهاجرت‌ها از ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("مهاجرت‌ها با موفقیت اعمال شدند.");

  await migrationClient.end();
}

main().catch((err) => {
  console.error("اجرای مهاجرت ناموفق بود:", err);
  process.exit(1);
});
