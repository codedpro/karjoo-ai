import "server-only";

/**
 * رانرِ «اپلایِ سمتِ سرور» برای سایت‌هایی که اپلای‌شان کاملاً HTTP است.
 *
 * چرا جدا از ناوگان؟ ناوگان با Playwright نشستِ کاربر را در یک مرورگرِ واقعی replay
 * می‌کند، چون جابینجا و جاب‌ویژن فرمِ DOM دارند. ایران‌تلنت، کاربوم و ای‌استخدام اما
 * تراکنش‌شان چند درخواستِ HTTP است؛ پس همین‌جا در کنترل‌پلین انجامش می‌دهیم: سریع‌تر،
 * بدونِ نودِ ورکر، و بدونِ سلکتورِ شکننده.
 *
 * ترتیبِ کار برای هر کاربر و هر سایت:
 *   ۱) فیلترهای خودِ کاربر (آیا این سایت را روشن کرده؟)
 *   ۲) گیتِ اپلای خودکارِ سرور (همان گیتی که ناوگان استفاده می‌کند)
 *   ۳) claimِ آیتم‌های همان سایت
 *   ۴) نشست از خزانه؛ اگر نبود، ورودِ خودکار با اعتبارنامه‌ی ذخیره‌شده
 *   ۵) اجرای اپلای، و ثبتِ نتیجه با همان مسیرِ recordFleetResult
 *
 * **یک** رانر برای هر سه سایت، عمداً: پیش از این ایران‌تلنت رانرِ خودش را داشت و هر
 * سایتِ تازه یعنی یک کپیِ دیگر از همین گیت‌ها. همان‌طور که نسخه‌ی دوگانه‌ی APPLY_SPEC
 * بینِ کنترل‌پلین و ورکر از هم دور افتاد، این کپی‌ها هم دور می‌افتادند. تفاوتِ هر سایت
 * فقط در `BOARD_EXECUTORS` می‌نشیند.
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
import { applyToEEstekhdam } from "@/lib/apply/boards/eestekhdam-apply";
import { applyToIranTalent } from "@/lib/apply/boards/irantalent-apply";
import { applyToKarboom } from "@/lib/apply/boards/karboom-apply";
import {
  assertServerAutoApplyAllowed,
  AutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import { boardsForChannel } from "@/lib/apply/apply-channels";
import { claimUserApplyItems, type ClaimedApplyItem } from "@/lib/apply/extension-queue";
import { enabledApplyBoards, readApplyFilters } from "@/lib/apply/filters";
import { refreshSessionFromStoredCredential } from "@/lib/apply/login/session-provider";
import { readUserEntitlements } from "@/lib/billing/apply-quota-guard";
import {
  buildResumeFileName,
  defaultLoadResumeHtml,
  recordFleetResult,
} from "@/lib/fleet/dispatch";
import { logger } from "@/lib/observability/logger";
import { decryptSession } from "@/lib/vault/crypto";
import { readSessionBlob } from "@/lib/vault/store";

/** نتیجه‌ی یکسانِ همه‌ی اجراکننده‌ها — همان قراردادی که recordFleetResult می‌خواهد. */
export interface ServerApplyOutcome {
  status: "submitted" | "skipped" | "failed";
  reason?: string;
  ranSteps: string[];
  proof?: Record<string, unknown>;
}

/** رزومه‌ی اختصاصیِ رندرشده‌ی همین آگهی. */
export interface PreparedResume {
  pdf: Uint8Array;
  fileName: string;
}

export interface ServerApplyExecutorArgs {
  session: string;
  item: ClaimedApplyItem;
  /** فقط برای سایت‌هایی که `needsTailoredResume` دارند پُر است. */
  resume: PreparedResume | null;
}

interface BoardExecutor {
  /**
   * آیا این سایت PDFِ اختصاصیِ همان آگهی را آپلود می‌کند؟ `false` یعنی سایت رزومه را
   * از پروفایلِ خودش برمی‌دارد (ایران‌تلنت) و رندرِ PDF اصلاً لازم نیست.
   */
  needsTailoredResume: boolean;
  run(args: ServerApplyExecutorArgs): Promise<ServerApplyOutcome>;
  /** دلیلی که یعنی «نشست سوخت» — ادامه‌ی حلقه برای این کاربر بی‌فایده است. */
  sessionLostReason: string;
}

/**
 * سایت‌هایی که اپلایِ کنترل‌پلین دارند. افزودنِ سایتِ تازه = یک ورودی این‌جا.
 *
 * تنها منبعِ حقیقتِ «کدام سایت روی کنترل‌پلین اجرا می‌شود»؛ ناوگانِ Playwright هم از
 * همین کلیدها می‌فهمد چه چیزی را نباید به نودِ ورکر بدهد.
 */
export const BOARD_EXECUTORS: Record<string, BoardExecutor> = {
  irantalent: {
    needsTailoredResume: false,
    sessionLostReason: "irantalent_login_required",
    run: ({ session, item }) =>
      applyToIranTalent({
        session,
        jobUrl: item.listing.url,
        ...(item.coverLetter ? { coverLetter: item.coverLetter } : {}),
      }),
  },
  karboom: {
    needsTailoredResume: true,
    sessionLostReason: "karboom_login_required",
    run: async ({ session, item, resume }) => {
      if (!resume) {
        return { status: "skipped", reason: "tailored_resume_missing", ranSteps: [] };
      }
      return applyToKarboom({
        session,
        jobUrl: item.listing.url,
        resumePdf: resume.pdf,
        resumeFileName: resume.fileName,
        ...(item.coverLetter ? { coverLetter: item.coverLetter } : {}),
      });
    },
  },
  "e-estekhdam": {
    needsTailoredResume: true,
    sessionLostReason: "eestekhdam_login_required",
    run: async ({ session, item, resume }) => {
      if (!resume) {
        return { status: "skipped", reason: "tailored_resume_missing", ranSteps: [] };
      }
      return applyToEEstekhdam({
        session,
        jobUrl: item.listing.url,
        jobTitle: item.listing.title,
        resumePdf: resume.pdf,
        resumeFileName: resume.fileName,
        ...(item.coverLetter ? { coverLetter: item.coverLetter } : {}),
      });
    },
  },
};

/**
 * شناسه‌ی سایت‌هایی که اپلای‌شان روی کنترل‌پلین اجرا می‌شود.
 *
 * فهرست از `apply/apply-channels` می‌آید (همان جدولی که ناوگان هم می‌خواند)، نه از
 * کلیدهای `BOARD_EXECUTORS`؛ وگرنه دو فهرست می‌داشتیم که می‌توانستند از هم دور بیفتند.
 * `filter` تضمین می‌کند سایتی که کانالش کنترل‌پلین است ولی اجراکننده ندارد، بی‌سروصدا
 * از قلم نیفتد بلکه اصلاً برنگردد.
 */
export function controlPlaneApplyBoards(): string[] {
  return boardsForChannel("control_plane").filter((board) => board in BOARD_EXECUTORS);
}

/** آیا این سایت اجراکننده‌ی کنترل‌پلین دارد؟ */
export function hasControlPlaneExecutor(board: string): boolean {
  return board in BOARD_EXECUTORS;
}

export interface ServerApplySummary {
  users: number;
  attempted: number;
  submitted: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
}

export interface ServerApplyRunnerDeps {
  db?: typeof defaultDb;
  /** `fetch`ِ قابلِ تزریق — تست‌ها شبکه را این‌جا قطع می‌کنند. */
  fetchImpl?: typeof fetch;
}

function emptySummary(users = 0): ServerApplySummary {
  return { users, attempted: 0, submitted: 0, skipped: 0, failed: 0, reasons: {} };
}

function bump(reasons: Record<string, number>, key: string): void {
  reasons[key] = (reasons[key] ?? 0) + 1;
}

function merge(total: ServerApplySummary, part: ServerApplySummary): void {
  total.attempted += part.attempted;
  total.submitted += part.submitted;
  total.skipped += part.skipped;
  total.failed += part.failed;
  for (const [reason, count] of Object.entries(part.reasons)) {
    total.reasons[reason] = (total.reasons[reason] ?? 0) + count;
  }
}

async function readSessionText(
  userId: string,
  board: string,
  db: typeof defaultDb,
): Promise<string | null> {
  const blob = await readSessionBlob(userId, board as never, db);
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

/**
 * رزومه‌ی اختصاصیِ این آگهی را به PDF می‌رساند.
 *
 * `null` یعنی «این آگهی رزومه‌ی اختصاصی ندارد یا رندر نشد» — و فراخواننده به رزومه‌ی
 * دیگری پناه نمی‌برد: کارفرما باید همان رزومه‌ای را ببیند که برای همین آگهی نوشته شده.
 */
async function prepareResume(
  userId: string,
  item: ClaimedApplyItem,
  db: typeof defaultDb,
): Promise<PreparedResume | null> {
  const html = await defaultLoadResumeHtml(userId, item.listingId, db);
  if (!html) return null;
  try {
    // تنبل بارگذاری می‌شود: pdf-renderer در لحظه‌ی import مرورگر را وارد می‌کند و این
    // ماژول در مسیرهایی هم import می‌شود که هرگز PDF رندر نمی‌کنند (ایران‌تلنت).
    const { renderResumePdf } = await import("@/lib/resume/pdf-renderer");
    const pdf = await renderResumePdf(html);
    const fileName = (await buildResumeFileName(userId, item.listing.company, db)) ?? "resume.pdf";
    return { pdf, fileName };
  } catch (err) {
    logger.warn("server apply résumé render failed", {
      path: "fleet/server-apply",
      userId,
      board: item.board,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return null;
  }
}

/**
 * برای یک کاربر و یک سایت، آیتم‌های صف را از سمتِ سرور اجرا می‌کند.
 * اگر کاربر آن سایت را فعال نکرده یا گیتِ سرور اجازه ندهد، بی‌سروصدا صفر برمی‌گردد.
 */
export async function runServerApplyForUser(
  userId: string,
  board: string,
  limit: number,
  deps: ServerApplyRunnerDeps = {},
): Promise<ServerApplySummary> {
  const executor = BOARD_EXECUTORS[board];
  if (!executor) return emptySummary(1);

  const db = deps.db ?? defaultDb;
  const summary = emptySummary(1);

  const filters = await readApplyFilters(userId, db);
  if (!enabledApplyBoards(filters).includes(board as never)) {
    bump(summary.reasons, "provider_disabled");
    return summary;
  }

  let minScore: number;
  try {
    ({ minScore } = await assertServerAutoApplyAllowed(userId, await readUserEntitlements(userId), { db }));
  } catch (error) {
    bump(summary.reasons, error instanceof AutoApplyNotAllowedError ? error.code : "gate_error");
    return summary;
  }

  const items = await claimUserApplyItems(userId, limit, db, {
    minScore,
    // سایتی که PDF اختصاصی می‌خواهد فقط وقتی claim می‌شود که رزومه‌اش از قبل ساخته شده
    // باشد؛ وگرنه task در حالتِ leased گیر می‌کند و هیچ‌وقت اجرا نمی‌شود.
    requireTailoredResume: executor.needsTailoredResume,
    allowedBoards: [board as never],
  });
  if (items.length === 0) return summary;

  // نشست: از خزانه، وگرنه ورودِ خودکار با اعتبارنامه‌ی ذخیره‌شده (اگر این سایت درایورِ
  // ورود داشته باشد؛ نداشته باشد، refresh فقط false برمی‌گرداند).
  let stored = await readSessionText(userId, board, db);
  if (
    !stored &&
    (await refreshSessionFromStoredCredential(userId, board as never, {
      db,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }))
  ) {
    stored = await readSessionText(userId, board, db);
  }
  if (!stored) {
    bump(summary.reasons, "no_session");
    return summary;
  }
  const session: string = stored;

  for (const item of items) {
    summary.attempted += 1;

    const resume = executor.needsTailoredResume ? await prepareResume(userId, item, db) : null;
    const outcome = await executor.run({ session, item, resume });

    summary[outcome.status] += 1;
    if (outcome.reason) bump(summary.reasons, outcome.reason);
    await recordFleetResult(
      `control-plane:${board}`,
      {
        taskId: item.taskId,
        userId,
        status: outcome.status,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(outcome.proof ? { proof: outcome.proof } : {}),
      },
      { db },
    );

    // نشستی که وسطِ کار رد شد، ادامه دادن را بی‌فایده می‌کند.
    if (outcome.reason === executor.sessionLostReason) break;
  }
  return summary;
}

/**
 * کاربرانی که می‌توان این سایت را از سمتِ سرور برایشان اجرا کرد.
 *
 * برخلافِ زمان‌بندِ کشف — که وجودِ نشستِ زنده را شرط می‌کند — این‌جا داشتنِ **اعتبارنامه**
 * هم کافی است: کاربری که ورودِ خودکار را فعال کرده ممکن است هنوز هیچ نشستی نداشته باشد،
 * و دقیقاً هدفِ همین قابلیت این است که سرور خودش نشست بسازد.
 */
export async function listServerApplyUsers(
  board: string,
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
          eq(boardAccounts.board, board as never),
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

/** یک تیکِ کاملِ سمتِ سرور: همه‌ی سایت‌های کنترل‌پلین × همه‌ی کاربرانِ واجد. */
export async function runServerApplyTick(
  opts: { boards?: string[]; perUser?: number; deps?: ServerApplyRunnerDeps } = {},
): Promise<ServerApplySummary> {
  const deps = opts.deps ?? {};
  const db = deps.db ?? defaultDb;
  const perUser = Math.max(1, Math.min(opts.perUser ?? 3, 20));
  const boards = (opts.boards ?? controlPlaneApplyBoards()).filter(hasControlPlaneExecutor);

  const total = emptySummary();
  // یک کاربر ممکن است چند سایت داشته باشد؛ در شمارشِ `users` یک‌بار حساب می‌شود.
  const seenUsers = new Set<string>();

  for (const board of boards) {
    for (const userId of await listServerApplyUsers(board, db)) {
      seenUsers.add(userId);
      merge(total, await runServerApplyForUser(userId, board, perUser, deps));
    }
  }
  total.users = seenUsers.size;
  return total;
}
