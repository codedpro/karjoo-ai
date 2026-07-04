import "server-only";

/**
 * صفِ اپلایِ «حاضرِ کاربر» برای افزونه (CONTEXT، قاعده‌ی ۲).
 *
 * این لایه از صفِ سراسریِ ورکر (src/lib/queue) جداست چون معناشناسیِ متفاوتی دارد:
 *   • **مقید به همان کاربر** (قاعده‌ی ۴) — هر claim/result فقط روی task‌هایی که به
 *     match‌های همین userId اشاره می‌کنند کار می‌کند؛ هرگز cross-user.
 *   • **بدون پیشرویِ خودکار** (قاعده‌ی ۲) — claim فقط آیتم‌های pendingِ این کاربر را
 *     برای «اپلایِ کمکیِ حاضرِ کاربر» برمی‌گرداند؛ هیچ ارسالی بدونِ گزارشِ صریحِ افزونه
 *     (recordResult) رخ نمی‌دهد. claim وضعیتِ task را `leased` می‌کند تا UI تکراری
 *     نشود، ولی این «ارسال» نیست — صرفاً نمایش برای تأییدِ کاربر.
 *
 * همه‌ی وابستگی‌ها قابلِ تزریق‌اند (db) تا بدونِ DB/شبکه‌ی زنده تست شوند.
 */
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  applications,
  jobListings,
  matches,
  tasks,
  type ApplicationRow,
} from "@/db/schema";

/** هندلِ DB که این لایه نیاز دارد — همان کلاینتِ Drizzle. */
export type ExtensionQueueDb = typeof defaultDb;

/** یک آیتمِ اپلای که افزونه باید به کاربر نشان دهد تا تأیید کند. */
export interface ClaimedApplyItem {
  taskId: string;
  matchId: string;
  listingId: string;
  board: string;
  /**
   * حالتِ این task: 'filter' (اپلای بر اساسِ فیلترِ خودِ سایت، بدونِ AI) یا 'ai' (تطبیقِ
   * پریمیوم بالای آستانه). اختیاری برای سازگاریِ عقب‌رو؛ claim همیشه پُرش می‌کند.
   */
  mode?: "filter" | "ai";
  /** انگیزه‌نامه‌ی پیش‌نویس‌شده (از match/payload) برای پیش‌پُرکردنِ فرم. */
  coverLetter: string | null;
  matchScore: number | null;
  listing: {
    title: string;
    company: string | null;
    city: string | null;
    url: string;
  };
}

/** آپشن‌های قابلِ تزریقِ claim — برای گیتِ اپلای خودکار (آستانه). */
export interface ClaimOptions {
  /**
   * آستانه‌ی مؤثرِ امتیازِ تطبیق (قاعده‌ی ۱). اگر داده شود، task‌های *AIمود* فقط وقتی
   * برگردانده می‌شوند که match‌شان score ≥ minScore داشته باشد.
   *
   * استثنا (پیوُت محصول): task‌های *فیلترمود* (payload.mode='filter') هرگز گیتِ آستانه
   * نمی‌خورند — آن‌ها بر اساسِ فیلترِ خودِ سایت انتخاب شده‌اند نه AI؛ پس صرفِ نظر از score
   * (که در فیلترمود NULL است) همیشه claim‌شدنی‌اند. minScore فقط برای AIمود است.
   *
   * undefined ⇒ بدونِ فیلترِ آستانه (سازگاریِ عقب‌رو با مسیرِ کمکیِ حاضرِ کاربر).
   */
  minScore?: number;
}

/** آیا payloadِ این task فیلترمود است؟ (اپلای بر اساسِ فیلترِ سایت، بدونِ AI). */
export function isFilterModeTask(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).mode === "filter"
  );
}

/**
 * آیتم‌های اپلایِ pendingِ همین کاربر را برای اپلایِ کمکیِ حاضرِ کاربر برمی‌گرداند.
 *
 * فقط task‌هایی که: (۱) به match‌های همین `userId` اشاره می‌کنند، (۲) status='pending'،
 * (۳) run_after گذشته است، و (۴) اگر minScore داده شده باشد، score ≥ minScore (قاعده‌ی ۱).
 * آن‌ها را به `leased` می‌برد (تا در UI تکراری نشوند) و متادیتای آگهی + انگیزه‌نامه را
 * برای پیش‌پُرکردن برمی‌گرداند.
 *
 * نکته‌ی ایمنی: این «ارسال» نیست. ارسالِ واقعی پس از تأییدِ صریحِ کاربر در افزونه و با
 * فراخوانیِ `recordResult` ثبت می‌شود (قاعده‌ی ۲). فیلترِ آستانه تضمین می‌کند آیتمِ زیرِ
 * آستانه هرگز برای اپلایِ خودکار به افزونه نمی‌رسد.
 */
export async function claimUserApplyItems(
  userId: string,
  limit: number,
  conn: ExtensionQueueDb = defaultDb,
  opts: ClaimOptions = {},
): Promise<ClaimedApplyItem[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 25));

  // شرطِ گیت (قاعده‌ی ۱): اگر minScore داده شده، task‌های AIمود فقط بالای آستانه.
  // اما task‌های فیلترمود (payload.mode='filter') همیشه عبور می‌کنند — گیتِ آستانه فقط
  // برای AIمود است (پیوُت محصول). NULL score هرگز از gte عبور نمی‌کند؛ پس در فیلترمود
  // شرطِ OR لازم است تا آگهیِ امتیازنخورده هم claim شود.
  const filterModeCond = sql`${tasks.payload} ->> 'mode' = 'filter'`;
  const gate =
    opts.minScore === undefined
      ? undefined
      : or(filterModeCond, gte(matches.score, opts.minScore));

  // ۱) task‌های آماده‌ی همین کاربر را با join به match پیدا کن.
  // ترتیب: امتیازِ بالاتر اول (NULLS LAST تا آیتم‌های فیلترمودِ بی‌امتیاز آیتم‌های AI را
  // پس نزنند)، سپس زودترین run_after.
  const ready = await conn
    .select({ taskId: tasks.id })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .where(
      and(
        eq(matches.userId, userId),
        eq(tasks.status, "pending"),
        lte(tasks.runAfter, sql`now()`),
        ...(gate ? [gate] : []),
      ),
    )
    .orderBy(sql`${matches.score} DESC NULLS LAST`, tasks.runAfter)
    .limit(safeLimit);

  if (ready.length === 0) return [];
  const ids = ready.map((r) => r.taskId);

  // ۲) همین task‌ها را به leased ببر (با شرطِ هنوز-pending، race-safe). برای
  //    اطمینان از مالکیت، دوباره با join به همین userId مقید می‌کنیم.
  const leasedRows = await conn
    .update(tasks)
    .set({ status: "leased", leasedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(tasks.status, "pending"), inArray(tasks.id, ids)))
    .returning({ id: tasks.id });

  const leasedSet = new Set(leasedRows.map((r) => r.id));
  if (leasedSet.size === 0) return [];

  // ۳) جزئیاتِ آگهی + انگیزه‌نامه‌ی هر task را بخوان (دوباره مقید به همین userId).
  const detail = await conn
    .select({
      taskId: tasks.id,
      matchId: tasks.matchId,
      payload: tasks.payload,
      listingId: jobListings.id,
      board: jobListings.board,
      coverLetter: matches.coverLetter,
      matchScore: matches.score,
      title: jobListings.title,
      company: jobListings.company,
      city: jobListings.city,
      url: jobListings.url,
    })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .innerJoin(jobListings, eq(matches.listingId, jobListings.id))
    .where(eq(matches.userId, userId));

  return detail
    .filter((d) => leasedSet.has(d.taskId))
    .map((d) => ({
      taskId: d.taskId,
      matchId: d.matchId,
      listingId: d.listingId,
      board: d.board,
      mode: isFilterModeTask(d.payload) ? ("filter" as const) : ("ai" as const),
      coverLetter: d.coverLetter,
      matchScore: d.matchScore,
      listing: {
        title: d.title,
        company: d.company,
        city: d.city,
        url: d.url,
      },
    }));
}

/** نتیجه‌ی یک اقدامِ تأییدشده توسطِ کاربر در افزونه. */
export interface RecordResultInput {
  taskId: string;
  userId: string;
  status: "submitted" | "skipped" | "failed";
  externalRef?: string;
  reason?: string;
  proof?: Record<string, unknown>;
}

/** خروجیِ ثبتِ نتیجه. */
export interface RecordResultOutput {
  application: ApplicationRow;
  taskStatus: "succeeded" | "failed";
}

/**
 * نتیجه‌ی یک اپلایِ تأییدشده‌ی کاربر را ثبت می‌کند (channel='extension').
 *
 * گام‌ها (همگی مقید به همان userId — قاعده‌ی ۴):
 *   ۱) task را با اطمینان از تعلق به این کاربر پیدا کن (۴۰۴ اگر نباشد → null).
 *   ۲) یک ردیفِ applications برای match (idempotent روی matchId) upsert کن.
 *   ۳) task را نهایی کن: submitted/skipped → succeeded (دیگر retry نشود)؛
 *      failed → failed (با گزارشِ کاربر؛ مدیریتِ retry با لایه‌ی بالاتر).
 *
 * هرگز خودش task‌های دیگر را جلو نمی‌برد (قاعده‌ی ۲) — فقط همین یک نتیجه‌ی گزارش‌شده.
 * در صورتِ نبودِ task یا عدمِ تعلق به کاربر، null برمی‌گرداند (فراخواننده ۴۰۴ کند).
 */
export async function recordResult(
  input: RecordResultInput,
  conn: ExtensionQueueDb = defaultDb,
): Promise<RecordResultOutput | null> {
  // ۱) task را مقید به این کاربر بیاب (join به match).
  const [found] = await conn
    .select({
      taskId: tasks.id,
      matchId: tasks.matchId,
      listingId: matches.listingId,
      matchScore: matches.score,
      coverLetter: matches.coverLetter,
      taskStatus: tasks.status,
    })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .where(and(eq(tasks.id, input.taskId), eq(matches.userId, input.userId)))
    .limit(1);

  if (!found) return null;

  const now = new Date();
  const submitted = input.status === "submitted";
  const appStatus = input.status; // submitted | skipped | failed — هم‌راستا با applicationStatusEnum

  // ۲) ردیفِ applications را upsert کن (یکتا روی matchId).
  const [application] = await conn
    .insert(applications)
    .values({
      userId: input.userId,
      matchId: found.matchId,
      listingId: found.listingId,
      status: appStatus,
      channel: "extension",
      matchScore: found.matchScore,
      coverLetter: found.coverLetter,
      reason: input.reason ?? null,
      externalRef: input.externalRef ?? null,
      proof: input.proof ?? null,
      submittedAt: submitted ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: applications.matchId,
      set: {
        status: appStatus,
        channel: "extension",
        reason: input.reason ?? null,
        externalRef: input.externalRef ?? null,
        proof: input.proof ?? null,
        submittedAt: submitted ? now : null,
        updatedAt: now,
      },
    })
    .returning();

  // ۳) task را نهایی کن. submitted/skipped → succeeded (تمام)؛ failed → failed.
  const taskStatus: "succeeded" | "failed" =
    input.status === "failed" ? "failed" : "succeeded";

  await conn
    .update(tasks)
    .set({
      status: taskStatus,
      lastError: input.status === "failed" ? (input.reason ?? "reported failed") : null,
      leasedAt: null,
      updatedAt: now,
    })
    .where(eq(tasks.id, found.taskId));

  return { application, taskStatus };
}
