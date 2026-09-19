/**
 * Server-apply preflight — "could Karjoo apply for this user right now, and if
 * not, what is missing?"
 *
 * STRICTLY READ-ONLY. It never claims a task and never submits an application.
 * It answers, per board, the five questions that each silently stop a server-side
 * apply, in the order the runner hits them:
 *
 *   1. channel   — does this board have a server executor at all?
 *   2. filter    — has the user switched this board on? (default is jobinja only)
 *   3. queue     — are there pending tasks, and do they have a tailored résumé?
 *   4. session   — is there a vaulted session, and has it expired?
 *   5. network   — can this host even reach the board?
 *
 * Why it exists: every one of these fails QUIETLY by design (a disabled board or
 * a closed gate must not break the tick for other users), so a run that does
 * nothing looks identical to a run with nothing to do. Reading a summary of
 * `{"attempted":0}` tells you nothing about which of the five it was.
 *
 * (5) is the one that is easy to forget on a non-Iranian host: the boards behind
 * ArvanCloud refuse connections from outside Iran, so a perfectly configured
 * account still applies to nothing.
 *
 *   npm run preflight:server-apply -- --email=user@example.com
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const emailArg = process.argv.find((arg) => arg.startsWith("--email="));
const email = (emailArg?.slice("--email=".length) || "").trim();
if (!email) {
  throw new Error("usage: npm run preflight:server-apply -- --email=user@example.com");
}

/** The public origin we probe for reachability, per board. */
const BOARD_ORIGINS: Record<string, string> = {
  jobinja: "https://jobinja.ir",
  jobvision: "https://jobvision.ir",
  "e-estekhdam": "https://www.e-estekhdam.com",
  irantalent: "https://api.irantalent.com",
  karboom: "https://karboom.io",
};

const PROBE_TIMEOUT_MS = 15_000;

interface BoardReport {
  board: string;
  channel: string;
  accountStatus: string;
  filterEnabled: boolean;
  pendingTasks: number;
  pendingWithResume: number;
  session: string;
  credential: boolean;
  network: string;
  verdict: string;
}

async function probe(origin: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(origin, { method: "GET", signal: controller.signal, redirect: "follow" });
    return `reachable (HTTP ${res.status}, ${Date.now() - started}ms)`;
  } catch (err) {
    const reason = err instanceof Error ? err.name : String(err);
    return `UNREACHABLE (${reason === "AbortError" ? "timeout" : reason})`;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const [{ db }, { sql }, channels, { readApplyFilters, enabledApplyBoards }, registry] =
    await Promise.all([
      import("@/db"),
      import("drizzle-orm"),
      import("@/lib/apply/apply-channels"),
      import("@/lib/apply/filters"),
      import("@/lib/apply/registry"),
    ]);

  const [user] = (await db.execute(
    sql`select id, email, name from users where email = ${email} limit 1`,
  )) as unknown as { id: string; email: string; name: string | null }[];
  if (!user) throw new Error(`no user with email ${email}`);

  const [toggle] = (await db.execute(
    sql`select enabled, min_score from user_server_auto_apply where user_id = ${user.id} limit 1`,
  )) as unknown as { enabled: boolean; min_score: string }[];

  const filters = await readApplyFilters(user.id, db);
  const enabled = new Set<string>(enabledApplyBoards(filters));

  const accounts = (await db.execute(sql`
    select ba.board,
           ba.status,
           (bc.id is not null)                       as has_credential,
           sb.expires_at                             as expires_at,
           (sb.id is not null)                       as has_session
      from board_accounts ba
      left join session_blobs sb on sb.board_account_id = ba.id
      left join board_credentials bc on bc.board_account_id = ba.id
     where ba.user_id = ${user.id}
  `)) as unknown as {
    board: string;
    status: string;
    has_credential: boolean;
    has_session: boolean;
    expires_at: Date | null;
  }[];
  const accountByBoard = new Map(accounts.map((row) => [row.board, row]));

  const queued = (await db.execute(sql`
    select l.board,
           count(*)                                                      as pending,
           count(*) filter (where r.id is not null)                      as with_resume
      from tasks t
      join matches m on m.id = t.match_id
      join job_listings l on l.id = m.listing_id
      left join resumes r
        on r.user_id = m.user_id and r.listing_id = l.id and r.is_base = false
     where m.user_id = ${user.id}
       and t.status = 'pending'
     group by l.board
  `)) as unknown as { board: string; pending: string; with_resume: string }[];
  const queueByBoard = new Map(queued.map((row) => [row.board, row]));

  const boards = Object.keys(BOARD_ORIGINS);
  const networkByBoard = new Map(
    await Promise.all(
      boards.map(async (board) => [board, await probe(BOARD_ORIGINS[board]!)] as const),
    ),
  );

  const reports: BoardReport[] = boards.map((board) => {
    const account = accountByBoard.get(board);
    const queue = queueByBoard.get(board);
    const expiresAt = account?.expires_at ? new Date(account.expires_at) : null;
    const expired = expiresAt !== null && expiresAt.getTime() < Date.now();
    const session = !account?.has_session
      ? "NONE"
      : expired
        ? `EXPIRED (${expiresAt!.toISOString().slice(0, 10)})`
        : `ok (expires ${expiresAt ? expiresAt.toISOString().slice(0, 10) : "n/a"})`;
    const network = networkByBoard.get(board) ?? "unknown";
    const pending = Number(queue?.pending ?? 0);
    const pendingWithResume = Number(queue?.with_resume ?? 0);

    // The blockers, in the order the runner would hit them. First one wins —
    // fixing a later one changes nothing while an earlier one still holds.
    const blockers: string[] = [];
    if (!channels.isServerApplyBoard(board)) blockers.push("no server executor");
    if (account?.status !== "connected") blockers.push(`account ${account?.status ?? "missing"}`);
    if (!enabled.has(board)) blockers.push("board switched off in apply filters");
    if (!account?.has_session && !account?.has_credential) blockers.push("no session and no stored credential");
    else if (expired && !account?.has_credential) blockers.push("session expired, no credential to renew it");
    if (network.startsWith("UNREACHABLE")) blockers.push("board unreachable from this host");
    if (pending === 0) blockers.push("nothing queued");

    return {
      board,
      channel: channels.applyChannelOf(board),
      accountStatus: account?.status ?? "not connected",
      filterEnabled: enabled.has(board),
      pendingTasks: pending,
      pendingWithResume,
      session,
      credential: Boolean(account?.has_credential),
      network,
      verdict: blockers.length === 0 ? "READY" : `BLOCKED: ${blockers.join("; ")}`,
    };
  });

  console.log(`\nuser: ${user.email} (${user.name ?? "—"})  id=${user.id}`);
  console.log(
    `server auto-apply toggle: ${toggle ? `${toggle.enabled ? "ON" : "OFF"} (minScore ${toggle.min_score})` : "no row (OFF)"}`,
  );
  console.log(`apply-filter boards ON: ${[...enabled].join(", ") || "(none)"}\n`);

  for (const report of reports) {
    console.log(`── ${report.board}  [${report.channel}]  (${registry.BOARD_STATUS[report.board as never] ?? "?"})`);
    console.log(`     account      : ${report.accountStatus}`);
    console.log(`     filter on    : ${report.filterEnabled}`);
    console.log(`     session      : ${report.session}${report.credential ? " + credential" : ""}`);
    console.log(`     queue pending: ${report.pendingTasks} (with tailored résumé: ${report.pendingWithResume})`);
    console.log(`     network      : ${report.network}`);
    console.log(`     => ${report.verdict}\n`);
  }

  // The PDF renderer is a hard dependency of the two boards that upload a
  // per-ad résumé; if it cannot start, those applies skip rather than submit.
  process.stdout.write("résumé PDF renderer: ");
  try {
    const { renderResumePdf } = await import("@/lib/resume/pdf-renderer");
    const pdf = await renderResumePdf("<html><body><h1>preflight</h1></body></html>");
    const header = Buffer.from(pdf.subarray(0, 5)).toString("latin1");
    console.log(header === "%PDF-" ? `OK (${pdf.length} bytes)` : `BAD OUTPUT (${header})`);
  } catch (err) {
    console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  const ready = reports.filter((report) => report.verdict === "READY").map((report) => report.board);
  console.log(`\nREADY TO APPLY NOW: ${ready.length > 0 ? ready.join(", ") : "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
