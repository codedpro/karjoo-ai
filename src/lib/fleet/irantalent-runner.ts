import "server-only";

/**
 * اجرا کننده‌ی سمتِ سرورِ ایران‌تلنت — بدونِ مرورگر، بدونِ ورکر.
 *
 * چرا جدا از ناوگان؟ ناوگان با Playwright نشستِ کاربر را در یک مرورگرِ واقعی replay
 * می‌کند، چون جابینجا فرمِ DOM دارد. ایران‌تلنت اما یک APIِ JSON است؛ کلِ تراکنشِ اپلای
 * چند درخواستِ HTTP است. پس همین‌جا در کنترل‌پلین انجامش می‌دهیم: سریع‌تر، بدونِ نودِ
 * ورکر، و بدونِ سلکتورِ شکننده.
 *
 * ترتیبِ کار برای هر کاربر:
 *   ۱) گیتِ اپلای خودکارِ سرور (همان گیتی که ناوگان استفاده می‌کند).
 *   ۲) claim فقط آیتم‌های ایران‌تلنت، بدون نیاز به PDF اختصاصی.
 *   ۳) نشست از خزانه؛ اگر نبود، ورودِ خودکار با اعتبارنامه‌ی ذخیره‌شده.
 *   ۴) اپلای با رزومه‌ی پروفایلِ ایران‌تلنت، و ثبتِ نتیجه با همان مسیرِ recordFleetResult.
 */
import { and, eq, exists, or, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  boardAccounts,
  boardCredentials,
  sessionBlobs,
  userServerAutoApply,
  users,
} from "@/db/schema";
import { applyToIranTalent } from "@/lib/apply/boards/irantalent-apply";
import { refreshSessionFromStoredCredential } from "@/lib/apply/login/session-provider";
import { claimUserApplyItems } from "@/lib/apply/extension-queue";
import { readApplyFilters, enabledApplyBoards } from "@/lib/apply/filters";
import {
  assertServerAutoApplyAllowed,
  AutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import { readUserPlan } from "@/lib/billing/apply-quota-guard";
import {
  recordFleetResult,
} from "@/lib/fleet/dispatch";
import { readSessionBlob } from "@/lib/vault/store";
import { decryptSession } from "@/lib/vault/crypto";

const BOARD = "irantalent" as const;
/** نامِ نودِ مجازی برای ممیزی — اپلای روی خودِ کنترل‌پلین اجرا شد، نه روی نودِ ورکر. */
const RUNNER_NODE = "control-plane:irantalent";

export interface IranTalentRunSummary {
  users: number;
  attempted: number;
  submitted: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}

export interface IranTalentRunnerDeps {
  db?: typeof defaultDb;
  fetchImpl?: typeof fetch;
}

function bump(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

/**
 * برای یک کاربر، آیتم‌های ایران‌تلنتِ صف را از سمتِ سرور اجرا می‌کند.
 * اگر کاربر ایران‌تلنت را فعال نکرده یا گیتِ سرور اجازه ندهد، بی‌سروصدا صفر برمی‌گردد.
 */
export async function runIranTalentForUser(
  userId: string,
  limit: number,
  deps: IranTalentRunnerDeps = {},
): Promise<IranTalentRunSummary> {
  const db = deps.db ?? defaultDb;
  const summary: IranTalentRunSummary = {
    users: 1, attempted: 0, submitted: 0, skipped: 0, failed: 0, reasons: {},
  };

  const filters = await readApplyFilters(userId, db);
  if (!enabledApplyBoards(filters).includes(BOARD)) {
    bump(summary.reasons, "provider_disabled");
    return summary;
  }

  let minScore: number;
  try {
    ({ minScore } = await assertServerAutoApplyAllowed(userId, await readUserPlan(userId, db), { db }));
  } catch (error) {
    bump(summary.reasons, error instanceof AutoApplyNotAllowedError ? error.code : "gate_error");
    return summary;
  }

  const items = await claimUserApplyItems(userId, limit, db, {
    minScore,
    requireTailoredResume: false,
    allowedBoards: [BOARD],
  });
  if (items.length === 0) return summary;

  // نشست: از خزانه، وگرنه ورودِ خودکار با اعتبارنامه‌ی ذخیره‌شده.
  let stored = await readSessionText(userId, db);
  if (!stored && (await refreshSessionFromStoredCredential(userId, BOARD, {
    db,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  }))) {
    stored = await readSessionText(userId, db);
  }
  if (!stored) {
    bump(summary.reasons, "no_session");
    return summary;
  }
  const session: string = stored;

  for (const item of items) {
    summary.attempted += 1;
    const outcome = await applyToIranTalent({
      session,
      jobUrl: item.listing.url,
      ...(item.coverLetter ? { coverLetter: item.coverLetter } : {}),
    }, deps.fetchImpl ?? fetch);

    summary[outcome.status === "submitted" ? "submitted" : outcome.status === "skipped" ? "skipped" : "failed"] += 1;
    if (outcome.reason) bump(summary.reasons, outcome.reason);
    await report(item.taskId, userId, outcome.status, outcome.reason, db, outcome.ranSteps);

    // نشستی که وسطِ کار رد شد، ادامه دادن را بی‌فایده می‌کند.
    if (outcome.reason === "irantalent_login_required") break;
  }
  return summary;
}

async function readSessionText(userId: string, db: typeof defaultDb): Promise<string | null> {
  const blob = await readSessionBlob(userId, BOARD, db);
  if (!blob) return null;
  try {
    return decryptSession({
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      keyVersion: blob.keyVersion,
    });
  } catch {
    return null;
  }
}

async function report(
  taskId: string,
  userId: string,
  status: "submitted" | "skipped" | "failed",
  reason: string | undefined,
  db: typeof defaultDb,
  ranSteps?: string[],
): Promise<void> {
  await recordFleetResult(RUNNER_NODE, {
    taskId,
    userId,
    status,
    ...(reason ? { reason } : {}),
    ...(ranSteps ? { proof: { ranSteps } } : {}),
  }, { db });
}


/**
 * کاربرانی که می‌توان ایران‌تلنت را از سمتِ سرور برایشان اجرا کرد.
 *
 * برخلافِ زمان‌بندِ کشف — که وجودِ نشستِ زنده را شرط می‌کند — اینجا داشتنِ **اعتبارنامه**
 * هم کافی است: کاربری که ورودِ خودکار را فعال کرده هنوز ممکن است هیچ نشستی نداشته باشد،
 * و دقیقاً هدفِ همین قابلیت این است که سرور خودش نشست بسازد.
 */
export async function listIranTalentServerUsers(
  conn: typeof defaultDb = defaultDb,
  limit = 50,
): Promise<string[]> {
  const usable = exists(
    conn
      .select({ one: sql`1` })
      .from(boardAccounts)
      .leftJoin(sessionBlobs, eq(sessionBlobs.boardAccountId, boardAccounts.id))
      .leftJoin(boardCredentials, eq(boardCredentials.boardAccountId, boardAccounts.id))
      .where(
        and(
          eq(boardAccounts.userId, users.id),
          eq(boardAccounts.board, BOARD),
          eq(boardAccounts.status, "connected"),
          or(sql`${sessionBlobs.id} is not null`, sql`${boardCredentials.id} is not null`),
        ),
      ),
  );

  const rows = await conn
    .select({ userId: users.id })
    .from(users)
    .innerJoin(
      userServerAutoApply,
      and(eq(userServerAutoApply.userId, users.id), eq(userServerAutoApply.enabled, true)),
    )
    .where(usable)
    .limit(Math.max(1, Math.min(limit, 200)));
  return rows.map((row) => row.userId);
}

/** یک تیکِ کاملِ سمتِ سرورِ ایران‌تلنت روی همه‌ی کاربرانِ واجد. */
export async function runIranTalentTick(
  opts: { perUser?: number; deps?: IranTalentRunnerDeps } = {},
): Promise<IranTalentRunSummary> {
  const deps = opts.deps ?? {};
  const db = deps.db ?? defaultDb;
  const perUser = Math.max(1, Math.min(opts.perUser ?? 3, 20));
  const total: IranTalentRunSummary = {
    users: 0, attempted: 0, submitted: 0, skipped: 0, failed: 0, reasons: {},
  };
  for (const userId of await listIranTalentServerUsers(db)) {
    const summary = await runIranTalentForUser(userId, perUser, deps);
    total.users += 1;
    total.attempted += summary.attempted;
    total.submitted += summary.submitted;
    total.skipped += summary.skipped;
    total.failed += summary.failed;
    for (const [reason, count] of Object.entries(summary.reasons)) {
      total.reasons[reason] = (total.reasons[reason] ?? 0) + count;
    }
  }
  return total;
}
