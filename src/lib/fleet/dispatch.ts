import "server-only";

/**
 * توزیعِ امنِ کارها به نودِ ورکر + ثبتِ نتیجه (server-only) — قاعده‌ی ۳.
 *
 * این قلبِ امنیتیِ ناوگان است. یک نود فقط برای کاربرانی کار claim می‌کند که *به همین نود
 * تخصیص یافته‌اند* (worker_assignments) و فقط وقتی گیتِ اپلای خودکارِ *سرورِ* آن کاربر
 * بگذرد (assertServerAutoApplyAllowed: پلنِ دارای ورکر + تاگلِ سرور روشن + زیرِ سقف +
 * بالای آستانه). تاگلِ افزونه (سطحِ مرورگر) به این مسیر ربطی ندارد. برای هر کار، نشستِ
 * *خودِ همان کاربر* در سمتِ سرور رمزگشایی می‌شود (vault.decryptSession) و فقط به نودِ
 * تخصیص‌یافته فرستاده می‌شود — *کلیدِ خزانه هرگز کنترل‌پلین را ترک نمی‌کند*؛ فقط نشستِ
 * رمزگشایی‌شده‌ی هر-کار (روی کانالِ احرازشده) می‌رود، در حافظه استفاده و دور انداخته می‌شود.
 *
 * قواعدِ سختِ ایمنی:
 *   • نشستِ رمزگشایی‌شده *فقط* به‌خاطرِ تخصیصِ این نود به آن کاربر تولید می‌شود — هرگز
 *     cross-user؛ readSessionBlob خودش به (userId, board) مقید است.
 *   • نشستِ رمزگشایی‌شده *هرگز لاگ نمی‌شود* و *هرگز در DB پایدار نمی‌شود* — فقط در
 *     payloadِ پاسخ به نودِ مجاز برمی‌گردد و آنجا پس از کار دور انداخته می‌شود.
 *   • هر تلاش/نتیجه یک ردیفِ audit_events (recordAutoApplyAudit، channel=worker) و یک
 *     ردیفِ applications (channel='worker') می‌نویسد.
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند تا بدونِ DB/شبکه/رمزِ واقعی تست شوند.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { prepareNextTailoredResumeForQueue } from "@/lib/resume/queue-prep";
import { applications, candidateProfiles, jobListings, resumes, tasks, users } from "@/db/schema";
import type { Entitlements } from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
import {
  assertServerAutoApplyAllowed,
  recordAutoApplyAudit,
  ServerAutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import {
  claimUserApplyItems,
  isNativeProfileResumeBoard,
  recordResult as recordExtensionResult,
  type ClaimedApplyItem,
  type RecordResultInput,
  type RecordResultOutput,
} from "@/lib/apply/extension-queue";
import { decryptSession } from "@/lib/vault/crypto";
import { readSessionBlob, type Board } from "@/lib/vault/store";
import { refreshSessionFromStoredCredential } from "@/lib/apply/login/session-provider";
import { listUserIdsForNode } from "@/lib/fleet/assign";
import { logger } from "@/lib/observability/logger";
import {
  canServerExecute,
  markServerExecutionRunning,
} from "@/lib/apply/execution-run";
import { enabledApplyBoards, readApplyFilters } from "@/lib/apply/filters";
import { classifyBoardRefusal, deferBoardQueue } from "@/lib/apply/board-cooldown";
import { isWorkerApplyBoard } from "@/lib/apply/apply-channels";

/** هندلِ DB که این لایه نیاز دارد — کلاینتِ کاملِ Drizzle. */
export type FleetDispatchDb = typeof defaultDb;

/**
 * یک کارِ آماده‌ی اپلای که به نودِ ورکر فرستاده می‌شود. شاملِ نشستِ *رمزگشایی‌شده‌ی*
 * همان کاربر — این تنها چیزی است که خزانه را ترک می‌کند (نه کلید). نود آن را در حافظه
 * استفاده و پس از کار دور می‌اندازد.
 */
export interface FleetJob {
  taskId: string;
  /** کاربری که این کار برایش (و با نشستِ او) اجرا می‌شود — برای recordFleetResult. */
  userId: string;
  board: string;
  /** URLِ صفحه‌ی آگهی که نود باید به آن برود و فرم را پر/ثبت کند. */
  listingUrl: string;
  /**
   * عنوانِ آگهی. ای‌استخدام چند «عنوانِ شغلی» را زیرِ یک آگهی می‌گذارد و درخواست باید
   * بگوید کدام‌یک؛ بدونِ این، نود نمی‌تواند انتخاب کند و باید متوقف شود.
   */
  listingTitle: string;
  /** انگیزه‌نامه‌ی درفت‌شده برای پیش‌پُرکردنِ فرم (در صورتِ وجود). */
  coverLetter: string | null;
  /**
   * HTMLِ رزومه‌ی سفارشیِ *هدف‌گیری‌شده‌ی همین آگهی* (اگر ساخته شده باشد). نود آن را با
   * Playwright به PDF رندر می‌کند و در مسیرِ آپلودِ فرم (#apply_choice_uploaded_cv) می‌فرستد —
   * جایگزینِ انگیزه‌نامه در jobinja.
   */
  resumeHtml: string | null;
  /**
   * نامِ فایلِ رزومه هنگامِ آپلود — «نام کامل _ نامِ شرکت». کارفرما همین نام را می‌بیند،
   * پس نباید ردی از ابزار داشته باشد (پیش‌تر `karjoo-resume-<tag>-<ts>.pdf` می‌رفت).
   */
  resumeFileName?: string | null;
  /**
   * نشستِ رمزگشایی‌شده‌ی *خودِ همان کاربر* (JSONِ سریال‌شده‌ی کوکی/توکن/UA). فقط به این
   * نودِ تخصیص‌یافته می‌رود. هرگز لاگ/پایدار نشود.
   */
  session: string;
}

/** وابستگی‌های قابلِ تزریقِ claimFleetJobs — برای تستِ بدونِ DB/رمز. */
export interface ClaimFleetDeps {
  db?: FleetDispatchDb;
  /** خواننده‌ی userIdهای تخصیص‌یافته به نود (پیش‌فرض listUserIdsForNode). */
  readAssignedUserIds?: (nodeId: string) => Promise<string[]>;
  /** مزایای کاربر از اشتراکِ 1xai (null اگر کاربر نباشد). */
  readEntitlements?: (userId: string) => Promise<Entitlements | null>;
  /** گیتِ اپلای خودکارِ *سرور* (پیش‌فرض assertServerAutoApplyAllowed) — برمی‌گرداند {minScore}. */
  assertAllowed?: (userId: string, entitlements: Entitlements) => Promise<{ minScore: number }>;
  /** claim آیتم‌های صف برای یک کاربر (پیش‌فرض claimUserApplyItems). */
  claimItems?: (
    userId: string,
    limit: number,
    minScore: number,
  ) => Promise<ClaimedApplyItem[]>;
  /** خواننده‌ی نشستِ رمزشده + رمزگشای آن (پیش‌فرض vault). */
  loadSession?: (userId: string, board: Board) => Promise<string | null>;
  /** نشست را با اعتبارنامه‌ی ذخیره‌شده می‌سازد؛ true یعنی حالا نشست هست. */
  renewSession?: (userId: string, board: Board) => Promise<boolean>;
  /** خواننده‌ی HTMLِ رزومه‌ی سفارشیِ این آگهی (پیش‌فرض از جدولِ resumes؛ نبود → null). */
  loadResumeHtml?: (userId: string, listingId: string) => Promise<string | null>;
  /** آزادسازی task وقتی رزومه‌ی هدف‌گیری‌شده ساخته/خوانده نشد. */
  releaseMissingResumeTask?: (taskId: string) => Promise<void>;
  /** Shared queue ownership gate. */
  canExecute?: (userId: string) => Promise<boolean>;
  /** Marks this node as the active server owner before claiming. */
  markExecuting?: (userId: string, nodeId: string) => Promise<boolean>;
  /** Persists leased_by for challenge-safe release/ownership validation. */
  markTaskLeases?: (taskIds: string[], nodeId: string) => Promise<void>;
}

/** مزایای کاربر را از اشتراکِ 1xai می‌خواند (یا null اگر کاربر نباشد). */
async function readUserEntitlements(
  userId: string,
  db: FleetDispatchDb,
): Promise<Entitlements | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? readEntitlements(userId) : null;
}

/**
 * نشستِ رمزشده‌ی (کاربر، سایت) را می‌خواند و در سمتِ سرور رمزگشایی می‌کند — *فقط* چون
 * این نود به آن کاربر تخصیص یافته. کلیدِ خزانه اینجا (server-only) خوانده می‌شود و هرگز
 * بیرون نمی‌رود. اگر بلابی نباشد null (آن کار رد می‌شود).
 */
async function defaultLoadSession(
  userId: string,
  board: Board,
  db: FleetDispatchDb,
): Promise<string | null> {
  const blob = await readSessionBlob(userId, board, db);
  if (!blob) return null;
  // رمزگشایی در همان مرزِ server-only — خروجی هرگز لاگ/ذخیره نمی‌شود.
  return decryptSession({
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    keyVersion: blob.keyVersion,
  });
}

/**
 * HTMLِ رزومه‌ی سفارشیِ (user × listing × isBase=false) را برمی‌گرداند.
 *
 * این مسیر هرگز به رزومه‌ی عمومیِ پروفایل fallback نمی‌کند. رزومه‌های هدف‌گیری‌شده در
 * مرحله‌ی prepare ساخته می‌شوند؛ claim فقط HTML موجود را می‌خواند.
 */
export async function defaultLoadResumeHtml(
  userId: string,
  listingId: string,
  db: FleetDispatchDb,
): Promise<string | null> {
  try {
    const row = await db.query.resumes.findFirst({
      where: and(
        eq(resumes.userId, userId),
        eq(resumes.listingId, listingId),
        eq(resumes.isBase, false),
      ),
      columns: { content: true },
    });
    if (row?.content) return row.content;
  } catch (err) {
    logger.warn("fleet dispatch tailored resume unavailable", {
      path: "fleet/dispatch",
      userId,
      listingId,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return null;
  }
  return null;
}

async function releaseTaskForMissingResume(
  taskId: string,
  db: FleetDispatchDb,
): Promise<void> {
  await db
    .update(tasks)
    .set({
      status: "pending",
      leasedBy: null,
      leasedAt: null,
      lastError: "tailored_resume_unavailable",
      runAfter: sql`now() + interval '30 minutes'`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "leased")));
}

/**
 * برای یک نود، کارهای آماده‌ی اپلای را claim می‌کند — فقط برای کاربرانِ تخصیص‌یافته به
 * همین نود که گیتِ اپلای خودکارشان می‌گذرد، و فقط آیتم‌های بالای آستانه.
 *
 * جریان (به‌ازای هر کاربرِ تخصیص‌یافته):
 *   ۱) مزایای کاربر را از اشتراکِ 1xai بخوان (نبودِ کاربر → رد).
 *   ۲) assertServerAutoApplyAllowed(userId, entitlements) — اگر رد شد (اشتراکِ بی‌ورکر/تاگلِ سرور
 *      خاموش/سقف پر)، این کاربر را *بی‌سروصدا رد کن* (نودِ دیگران را بلاک نکن) و آیتمی برنگردان.
 *   ۳) claimUserApplyItems(userId, perUser, {minScore}) — آیتم‌های بالای آستانه را lease کن.
 *   ۴) برای هر آیتم، نشستِ همان (کاربر، board) را رمزگشایی کن؛ اگر نشست نباشد، آن آیتم را
 *      رد کن (نود بدونِ نشست نمی‌تواند کار کند). یک FleetJob با نشستِ رمزگشایی‌شده بساز.
 *
 * @param nodeId نودِ احرازشده (همیشه از اعتبارنامه، نه از بدنه — قاعده‌ی امنیت).
 * @param limit  سقفِ کلِ کارهای برگشتی در این فراخوانی (بین همه‌ی کاربران پخش می‌شود).
 */
export async function claimFleetJobs(
  nodeId: string,
  limit: number,
  deps: ClaimFleetDeps = {},
): Promise<FleetJob[]> {
  const db = deps.db ?? defaultDb;
  const readAssigned =
    deps.readAssignedUserIds ?? ((id: string) => listUserIdsForNode(id, db));
  const readUserBenefits =
    deps.readEntitlements ?? ((id: string) => readUserEntitlements(id, db));
  const assertAllowed =
    deps.assertAllowed ??
    ((userId: string, entitlements: Entitlements) =>
      assertServerAutoApplyAllowed(userId, entitlements, { db }));
  const claimItems =
    deps.claimItems ??
    (async (userId: string, lim: number, minScore: number) => {
      // Only boards on the WORKER channel are handed to a Playwright node. The
      // control-plane boards (IranTalent, Karboom, e-estekhdam) are not excluded
      // from the server — their apply is a pure HTTP transaction, so it runs on the
      // control plane instead (fleet/server-apply-runner.ts). Handing one to a node
      // would drive DOM steps against a board that has no form to drive.
      const allowedBoards = enabledApplyBoards(await readApplyFilters(userId, db)).filter(
        (board) => isWorkerApplyBoard(board),
      );
      const claimReady = () =>
        claimUserApplyItems(userId, lim, db, {
          minScore,
          requireTailoredResume: true,
          allowedBoards,
        });
      const ready = await claimReady();
      if (ready.length > 0) return ready;
      // Nothing ready — generate the resume for the next job in line only.
      const prepared = await prepareNextTailoredResumeForQueue(userId, { db, allowedBoards });
      return prepared.status === "ready" ? claimReady() : [];
    });
  const loadSession =
    deps.loadSession ??
    ((userId: string, board: Board) => defaultLoadSession(userId, board, db));
  // وقتی نشستی در خزانه نیست (یا منقضی شده) و کاربر «ورودِ خودکار» را فعال کرده،
  // سرور خودش یک‌بار وارد می‌شود و نشست می‌سازد. اگر اعتبارنامه‌ای نباشد، بی‌سروصدا
  // false برمی‌گردد و کار همان‌طور که قبلاً بود به مسیرِ افزونه می‌افتد.
  const renewSession =
    deps.renewSession ??
    ((userId: string, board: Board) =>
      refreshSessionFromStoredCredential(userId, board, { db }));
  const loadResumeHtml =
    deps.loadResumeHtml ??
    ((userId: string, listingId: string) => defaultLoadResumeHtml(userId, listingId, db));
  const releaseMissingResumeTask =
    deps.releaseMissingResumeTask ?? ((taskId: string) => releaseTaskForMissingResume(taskId, db));
  const isolatedTestDeps = deps.readAssignedUserIds !== undefined;
  const canExecute =
    deps.canExecute ??
    (isolatedTestDeps ? async () => true : (userId: string) => canServerExecute(userId, db));
  const markExecuting =
    deps.markExecuting ??
    (isolatedTestDeps
      ? async () => true
      : (userId: string, id: string) => markServerExecutionRunning(userId, id, db));
  const markTaskLeases =
    deps.markTaskLeases ??
    (isolatedTestDeps
      ? async () => {}
      : async (taskIds: string[], id: string) => {
          if (taskIds.length === 0) return;
          await db
            .update(tasks)
            .set({ leasedBy: id, updatedAt: sql`now()` })
            .where(and(eq(tasks.status, "leased"), inArray(tasks.id, taskIds)));
        });

  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];

  const userIds = await readAssigned(nodeId);
  if (userIds.length === 0) return [];

  const jobs: FleetJob[] = [];

  for (const userId of userIds) {
    if (jobs.length >= safeLimit) break;

    // Shared ownership: an active/paused extension run owns this account until
    // the user explicitly switches back. A blocked server run also stays stopped.
    if (!(await canExecute(userId))) continue;

    // ۱) پلن.
    const entitlements = await readUserBenefits(userId);
    if (!entitlements) continue;

    // ۲) گیتِ اپلای خودکار — ردِ بی‌سروصدا (نودِ بقیه را بلاک نکن).
    let minScore: number;
    try {
      ({ minScore } = await assertAllowed(userId, entitlements));
    } catch (gateErr) {
      // ServerAutoApplyNotAllowedError (پلنِ بی‌ورکر/تاگلِ سرور خاموش/سقف پر) رفتارِ
      // *موردانتظار* است و بی‌سروصدا رد می‌شود. ولی هر خطای *غیرمنتظره‌ی دیگری* در
      // مسیرِ دیسپچِ ناوگان باید در هابِ مشاهده‌پذیری (Loki) دیده شود — بدونِ تغییرِ
      // کنترل‌فلو (در هر حال continue) و بدونِ نشتِ نشست/راز. logger هرگز throw نمی‌کند.
      if (!(gateErr instanceof ServerAutoApplyNotAllowedError)) {
        logger.error("fleet dispatch gate unexpected error", {
          path: "fleet/dispatch",
          nodeId,
          userId,
          err: gateErr instanceof Error ? gateErr : new Error(String(gateErr)),
        });
      }
      continue;
    }

    if (!(await markExecuting(userId, nodeId))) continue;

    // ۳) claimِ بالای آستانه — فقط به‌اندازه‌ی ظرفیتِ باقی‌مانده.
    const remaining = safeLimit - jobs.length;
    const items = await claimItems(userId, remaining, minScore);
    await markTaskLeases(items.map((item) => item.taskId), nodeId);

    // ۴) برای هر آیتم نشست را رمزگشایی کن (فقط چون نود به این کاربر تخصیص دارد).
    for (const item of items) {
      if (jobs.length >= safeLimit) break;
      const board = item.board as Board;
      let session = await loadSession(userId, board);
      if (!session && (await renewSession(userId, board))) {
        session = await loadSession(userId, board);
      }
      if (!session) continue; // بدونِ نشست، کار اجراشدنی نیست — رد.
      // A board that sends the résumé already on the user's provider profile
      // (JobVision) has nothing to upload, so a missing tailored résumé must not
      // drop the job — releasing it here parked every JobVision task on a 30-minute
      // retry loop that could never succeed.
      const needsTailoredResume = !isNativeProfileResumeBoard(item.board);
      const resumeHtml = needsTailoredResume ? await loadResumeHtml(userId, item.listingId) : null;
      if (needsTailoredResume && !resumeHtml) {
        await releaseMissingResumeTask(item.taskId);
        continue;
      }
      jobs.push({
        taskId: item.taskId,
        userId,
        board: item.board,
        listingUrl: item.listing.url,
        listingTitle: item.listing.title,
        coverLetter: item.coverLetter,
        resumeHtml,
        resumeFileName: await buildResumeFileName(userId, item.listing.company, db),
        session,
      });
    }
  }

  return jobs;
}

/* ───────────────────────────  ثبتِ نتیجه‌ی ورکر  ───────────────────────── */

/** نتیجه‌ی یک کارِ اجراشده توسطِ نود (گزارش‌شده به سرور). */
export interface FleetResultInput {
  taskId: string;
  /** کاربری که این کار برایش اجرا شد (از همان FleetJob.userId). */
  userId: string;
  status: "submitted" | "skipped" | "failed";
  externalRef?: string;
  reason?: string;
  /** اثباتِ ساخت‌یافته (پاسخِ سایت/اسکرین‌شات) — هرگز نشست/کوکی/توکن. */
  proof?: Record<string, unknown>;
}

/** وابستگی‌های قابلِ تزریقِ recordFleetResult. */
export interface RecordFleetDeps {
  db?: FleetDispatchDb;
  /** ثبتِ نتیجه روی صف/applications (پیش‌فرض extension-queue.recordResult). */
  recordResultFn?: (
    input: RecordResultInput,
    conn?: FleetDispatchDb,
  ) => Promise<RecordResultOutput | null>;
  /** نوشتنِ ممیزی (پیش‌فرض recordAutoApplyAudit). */
  auditFn?: typeof recordAutoApplyAudit;
}

/**
 * نتیجه‌ی یک کارِ اجراشده توسطِ نود را ثبت می‌کند (channel='worker').
 *
 * گام‌ها (همه مقید به همان userId — قاعده‌ی امنیت):
 *   ۱) recordResult: یک ردیفِ applications (idempotent روی matchId) با channel='worker'
 *      upsert و task را نهایی می‌کند. اگر task به این کاربر تعلق نداشته باشد → null
 *      (فراخواننده ۴۰۴/۴۰۹ کند) و *هیچ* ممیزی/نتیجه‌ای ثبت نمی‌شود.
 *   ۲) یک ردیفِ audit_events (auto_apply_attempted) با channel=worker و متادیتای تصمیم
 *      می‌نویسد. هرگز نشست/راز در متادیتا نیست.
 *
 * نکته: recordResult پایه channel را 'extension' می‌گذارد؛ اینجا پس از آن، channel را
 * صریحاً به 'worker' اصلاح می‌کنیم تا منشأِ واقعیِ اپلای (نودِ ورکر) ثبت بماند.
 */
export async function recordFleetResult(
  nodeId: string,
  input: FleetResultInput,
  deps: RecordFleetDeps = {},
): Promise<RecordResultOutput | null> {
  const db = deps.db ?? defaultDb;
  const recordResultFn = deps.recordResultFn ?? recordExtensionResult;
  const auditFn = deps.auditFn ?? recordAutoApplyAudit;

  // ۱) ثبتِ نتیجه (مقید به userId). نبودِ task/عدمِ تعلق → null، بدونِ ممیزی.
  const result = await recordResultFn(
    {
      taskId: input.taskId,
      userId: input.userId,
      status: input.status,
      ...(input.externalRef !== undefined ? { externalRef: input.externalRef } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.proof !== undefined ? { proof: input.proof } : {}),
    },
    db,
  );
  if (!result) return null;

  // channel را به 'worker' اصلاح کن (منشأِ واقعیِ این اپلای).
  await db
    .update(applications)
    .set({ channel: "worker" })
    .where(eq(applications.id, result.application.id));

  // ۲) ممیزیِ اپلای خودکار (channel=worker). هرگز نشست/راز در متادیتا.
  await auditFn(
    {
      userId: input.userId,
      eventType: "auto_apply_attempted",
      applicationId: result.application.id,
      metadata: {
        channel: "worker",
        nodeId,
        taskId: input.taskId,
        status: input.status,
        ...(input.externalRef ? { externalRef: input.externalRef } : {}),
      },
    },
    db,
  );

  // ۳) اگر سایت ما را پس زد (کپچا/۴۲۹/نشستِ رد‌شده)، صفِ همین (کاربر، سایت) را عقب
  // بینداز. بدونِ این، تیکِ بعدی — ۶۰ ثانیه بعد برای ورکر، ۵ دقیقه بعد برای سرور —
  // دقیقاً همان کار را تکرار می‌کند، و همین اصرارِ پیاپی است که حسابِ کاربر را به
  // چشم می‌آورد، نه خودِ اپلای. fail-soft: مکث نگرفتن نباید ثبتِ نتیجه را بشکند.
  const refusal = classifyBoardRefusal(input.reason);
  if (refusal) {
    try {
      const board = await boardOfListing(result.application.listingId, db);
      if (board) {
        const deferred = await deferBoardQueue(input.userId, board, refusal, db);
        logger.info("board cooldown applied", {
          path: "fleet/dispatch",
          userId: input.userId,
          board,
          refusal,
          deferredTasks: deferred,
        });
      }
    } catch (err) {
      logger.warn("board cooldown could not be applied", {
        path: "fleet/dispatch",
        userId: input.userId,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return { ...result, application: { ...result.application, channel: "worker" } };
}

/** سایتِ یک آگهی — برای گرفتنِ مکث لازم است و روی نتیجه نمی‌آید. */
async function boardOfListing(listingId: string, db: FleetDispatchDb): Promise<string | null> {
  const row = await db.query.jobListings.findFirst({
    where: eq(jobListings.id, listingId),
    columns: { board: true },
  });
  return row?.board ?? null;
}

/**
 * نامِ فایلِ رزومه برای آپلود: «نام کامل _ نامِ شرکت». همین نام در سایتِ کارفرما دیده
 * می‌شود، پس نباید ردی از ابزار داشته باشد (پیش‌تر `karjoo-resume-<tag>-<ts>.pdf` بود).
 */
export async function buildResumeFileName(
  userId: string,
  company: string | null | undefined,
  db: FleetDispatchDb,
): Promise<string | null> {
  try {
    const { resumeFileName } = await import("@/lib/resume/resume-templates");
    const prof = await db.query.candidateProfiles.findFirst({
      where: eq(candidateProfiles.userId, userId),
      columns: { fullName: true },
    });
    if (!prof?.fullName) return null;
    // همان قاعده‌ی مسیرِ افزونه: ASCII و یکتا، تا آپلود روی هیچ بک‌اندی نماند.
    return resumeFileName(prof.fullName, company ?? null);
  } catch {
    return null;
  }
}
