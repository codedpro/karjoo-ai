import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const email = (emailArg?.slice("--email=".length) || process.env.KARJOO_REPAIR_EMAIL || "").trim();
const days = Math.max(1, Math.min(45, Number(daysArg?.slice("--days=".length) || 7)));

if (!email) {
  throw new Error("usage: npm run repair:provider-failures -- --email=user@example.com [--days=7] [--apply]");
}

interface RepairRow {
  application_id: string;
  match_id: string;
  board: string;
  job_url: string;
  reason: string;
  repair_kind: "verify" | "retry";
}

async function main(): Promise<void> {
  const [{ db }, { sql }, { retryFailedApplication }, verification] = await Promise.all([
    import("@/db"),
    import("drizzle-orm"),
    import("@/lib/apply/interview-prep"),
    import("@/lib/apply/boards/jobinja-verification"),
  ]);

  const users = await db.execute(sql`select id from users where lower(email) = lower(${email}) limit 1`);
  const userId = (users as unknown as Array<{ id: string }>)[0]?.id;
  if (!userId) throw new Error(`user not found: ${email}`);

  const rows = await db.execute(sql`
    select
      a.id as application_id,
      a.match_id,
      l.board::text as board,
      l.url as job_url,
      coalesce(a.reason, '') as reason,
      case
        when l.board = 'jobinja' and (
          a.reason ilike '%back/forward cache%message channel is closed%' or
          a.reason ilike '%message port closed before a response%'
        ) then 'verify'
        else 'retry'
      end as repair_kind
    from applications a
    inner join job_listings l on l.id = a.listing_id
    where a.user_id = ${userId}
      and a.status = 'failed'
      and a.updated_at >= now() - (${days} * interval '1 day')
      and (
        (
          l.board = 'jobinja' and (
            a.reason ilike '%back/forward cache%message channel is closed%' or
            a.reason ilike '%message port closed before a response%' or
            a.reason like 'selector not found: #apply_choice_uploaded_cv%' or
            a.reason like 'waitFor timeout: #apply-form%' or
            a.reason like 'resume_upload_failed: input not found: #apply-form%'
          )
        ) or (
          l.board = 'e-estekhdam' and (
            a.reason like 'eestekhdam_file_limit_reached:%' or
            a.reason like 'eestekhdam_apply_failed:%خطا در زمان ذخیره فایل%' or
            a.reason like 'eestekhdam_apply_failed_after_cleanup:%خطا در زمان ذخیره فایل%' or
            a.reason = 'eestekhdam_apply_failed' or
            a.reason like 'eestekhdam_submission_unconfirmed:%' or
            a.reason like 'Could not establish connection.%' or
            a.reason like 'resume_download_failed:%'
          )
        ) or (
          l.board = 'jobvision' and (
            a.reason = 'jobvision_apply_button_missing' or
            a.reason = 'provider_submission_unconfirmed: historical record quarantined for provider verification'
          )
        ) or (
          l.board = 'irantalent' and
          a.reason = 'provider_submission_unconfirmed: historical record quarantined for provider verification'
        )
      )
    order by a.updated_at asc
  `) as unknown as RepairRow[];

  const summary = rows.reduce<Record<string, number>>((counts, row) => {
    const key = `${row.board}:${row.repair_kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", email, days, total: rows.length, summary }, null, 2));
  if (!apply) {
    process.exit(0);
  }

  let movedToVerification = 0;
  let retried = 0;
  let rejected = 0;
  for (const row of rows) {
    if (row.repair_kind === "verify") {
      await db.execute(sql`
        update applications
        set status = 'verifying'::application_status,
            reason = 'jobinja_submission_unconfirmed_after_navigation: repaired from browser channel closure',
            submitted_at = null,
            updated_at = now()
        where id = ${row.application_id} and user_id = ${userId}
      `);
      await db.execute(sql`
        update tasks
        set status = 'verifying'::task_status, leased_by = null, leased_at = null,
            last_error = 'jobinja_submission_unconfirmed_after_navigation', updated_at = now()
        where match_id = ${row.match_id}
      `);
      movedToVerification += 1;
      continue;
    }

    const result = await retryFailedApplication(userId, row.application_id, db);
    if (result.ok) {
      retried += 1;
      continue;
    }
    if (result.reason === "no_task") {
      await db.execute(sql`
        insert into tasks (idempotency_key, match_id, payload, status, run_after, updated_at)
        values (
          ${`apply:${row.match_id}`},
          ${row.match_id},
          ${JSON.stringify({ board: row.board, url: row.job_url, mode: "manual" })}::jsonb,
          'pending'::task_status,
          now(),
          now()
        )
        on conflict (idempotency_key) do update set
          status = 'pending'::task_status,
          attempts = 0,
          leased_by = null,
          leased_at = null,
          last_error = null,
          run_after = now(),
          updated_at = now()
      `);
      await db.execute(sql`
        update applications
        set status = 'draft'::application_status, reason = 'retry queued', updated_at = now()
        where id = ${row.application_id} and user_id = ${userId}
      `);
      await db.execute(sql`
        update matches set status = 'queued'::match_status, updated_at = now()
        where id = ${row.match_id} and user_id = ${userId}
      `);
      retried += 1;
      continue;
    }
    rejected += 1;
  }

  const reconciled = await verification.reconcileJobinjaFromStoredHistory(userId, db);
  console.log(JSON.stringify({ movedToVerification, retried, rejected, reconciled }, null, 2));
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
