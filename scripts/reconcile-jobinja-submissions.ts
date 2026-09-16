import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const email = (emailArg?.slice("--email=".length) || process.env.KARJOO_REPAIR_EMAIL || "").trim();

if (!email) {
  throw new Error("usage: npm run repair:jobinja-verification -- --email=user@example.com [--apply]");
}

async function main(): Promise<void> {
  const [{ db }, { sql }, verification, jobinjaRead] = await Promise.all([
    import("@/db"),
    import("drizzle-orm"),
    import("@/lib/apply/boards/jobinja-verification"),
    import("@/lib/apply/boards/jobinja-read"),
  ]);

  async function report() {
    const rows = await db.execute(sql`
    with target_user as (
      select id from users where lower(email) = lower(${email}) limit 1
    ), uncertain as (
      select
        a.id,
        a.status,
        a.reason,
        case
          when a.reason like '%corrected historical%' then a.created_at
          else a.updated_at
        end as attempted_at,
        lower(substring(l.url from '/jobs/([A-Za-z0-9]+)')) as job_id
      from applications a
      inner join job_listings l on l.id = a.listing_id
      where a.user_id = (select id from target_user)
        and l.board = 'jobinja'
        and a.reason like 'jobinja_submission_unconfirmed%'
    )
    select
      count(*)::int as uncertain,
      count(*) filter (where status::text = 'verifying')::int as verifying,
      count(*) filter (
        where exists (
          select 1
          from board_applications ba
          where ba.user_id = (select id from target_user)
            and ba.board = 'jobinja'
            and lower(substring(coalesce(ba.url, '') from '/jobs/([A-Za-z0-9]+)')) = uncertain.job_id
        )
      )::int as predicted_confirmed,
      count(*) filter (
        where not exists (
          select 1
          from board_applications ba
          where ba.user_id = (select id from target_user)
            and ba.board = 'jobinja'
            and lower(substring(coalesce(ba.url, '') from '/jobs/([A-Za-z0-9]+)')) = uncertain.job_id
        ) and attempted_at >= now() - interval '45 days'
      )::int as predicted_retryable_after_complete_sync,
      count(*) filter (
        where not exists (
          select 1
          from board_applications ba
          where ba.user_id = (select id from target_user)
            and ba.board = 'jobinja'
            and lower(substring(coalesce(ba.url, '') from '/jobs/([A-Za-z0-9]+)')) = uncertain.job_id
        ) and attempted_at < now() - interval '45 days'
      )::int as predicted_unresolved
    from uncertain
  `);
    return (rows as unknown as Record<string, unknown>[])[0] ?? {};
  }

  const users = await db.execute(sql`select id from users where lower(email) = lower(${email}) limit 1`);
  const userId = (users as unknown as Array<{ id: string }>)[0]?.id;
  if (!userId) throw new Error(`user not found: ${email}`);

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", email, ...(await report()) }, null, 2));
  if (!apply) {
    process.exit(0);
  }

  const marked = await verification.markJobinjaUnconfirmedForVerification(userId);
  const retainedHistory = await verification.reconcileJobinjaFromStoredHistory(userId);
  const sync = await jobinjaRead.syncJobinjaFromVault(userId);
  console.log(JSON.stringify({ marked, retainedHistory, sync, after: await report() }, null, 2));
  process.exit(!sync.ok || !sync.historyComplete ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
