/**
 * پُرکردنِ `job_listings.posted_at` برای آگهی‌هایی که تاریخِ انتشار ندارند.
 *
 * چرا لازم شد: کارتِ نتایجِ جست‌وجوی جابینجا تاریخِ انتشار را نمی‌دهد، پس هر آگهیِ کشف‌شده
 * با `posted_at = NULL` ذخیره می‌شد و «مرتب‌سازی بر اساسِ زمانِ انتشارِ آگهی» در داشبورد
 * هیچ داده‌ای برای مرتب‌کردن نداشت. تاریخِ دقیق در JSON-LDِ صفحه‌ی خودِ آگهی هست
 * (`"datePosted": "2026-07-29"`)، پس صفحه را یک‌بار می‌گیریم و همان را ذخیره می‌کنیم.
 *
 * ادب: ترتیبی (نه موازی) با فاصله‌ی مکث بینِ درخواست‌ها، همان User-Agent و همان بررسیِ
 * robots که بقیه‌ی کانکتور دارد. خطای یک آگهی بقیه را متوقف نمی‌کند.
 *
 * اجرا:  npx tsx --conditions=react-server scripts/backfill-posted-dates.mts [حداکثرتعداد]
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobListings } from "@/db/schema";
import { fetchJobMeta } from "@/lib/apply/boards/jobinja";

/** مکثِ بینِ درخواست‌ها — بارِ ناگهانی روی جابینجا نگذاریم. */
const DELAY_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = Number.parseInt(process.argv[2] ?? "", 10) || 500;

  const rows = await db
    .select({ id: jobListings.id, url: jobListings.url, title: jobListings.title })
    .from(jobListings)
    .where(and(eq(jobListings.board, "jobinja"), isNull(jobListings.postedAt)))
    .limit(limit);

  console.log(`آگهی‌های بدونِ تاریخِ انتشار: ${rows.length}`);
  let filled = 0;
  let missed = 0;

  for (const [i, row] of rows.entries()) {
    if (!row.url) continue;
    const { postedAt, description } = await fetchJobMeta(row.url);
    if (postedAt) {
      await db
        .update(jobListings)
        .set({
          postedAt,
          // اگر شرح هم نداشتیم، همین یک بار گرفتنِ صفحه آن را هم می‌دهد — دوباره نگیریم.
          ...(description ? { description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(jobListings.id, row.id));
      filled += 1;
    } else {
      missed += 1;
    }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${rows.length} — پُرشده: ${filled}`);
    await sleep(DELAY_MS);
  }

  const [{ n } = { n: 0 }] = (await db.execute<{ n: number }>(
    sql`select count(posted_at)::int as n from job_listings`,
  )) as unknown as { n: number }[];
  console.log(`پایان — پُرشده: ${filled}، بدونِ تاریخ: ${missed}، مجموعِ آگهی‌های تاریخ‌دار: ${n}`);
  process.exit(0);
}

void main();
