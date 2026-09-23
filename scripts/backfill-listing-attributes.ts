/**
 * Re-derive the unified attributes (category, job type, remote, clean city) for
 * every job listing. Safe to re-run: it only rewrites derived columns, and the
 * same listing always derives the same values.
 *
 * Run after changing the rules in src/lib/apply/listing-attributes.ts:
 *   npm run backfill:listing-attributes
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function main(): Promise<void> {
  const [{ db }, { sql }, { deriveListingAttributes }] = await Promise.all([
    import("@/db"),
    import("drizzle-orm"),
    import("@/lib/apply/listing-attributes"),
  ]);

  const BATCH = 500;
  let lastId = "00000000-0000-0000-0000-000000000000";
  let updated = 0;
  for (;;) {
    const rows = (await db.execute(sql`
      select id, title, description, city from job_listings
       where id > ${lastId} order by id limit ${BATCH}
    `)) as unknown as { id: string; title: string; description: string | null; city: string | null }[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const a = deriveListingAttributes(row);
      await db.execute(sql`
        update job_listings
           set category = ${a.category}, employment_type = ${a.employmentType},
               is_remote = ${a.remote}, city_norm = ${a.city}
         where id = ${row.id}
      `);
      updated += 1;
    }
    lastId = rows[rows.length - 1]!.id;
  }
  console.log(`re-derived attributes for ${updated} listings`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
