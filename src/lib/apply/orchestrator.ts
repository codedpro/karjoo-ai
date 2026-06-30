import "server-only";

/**
 * هماهنگ‌کننده‌ی فاز ۱ (فقط-خواندنی): ingest عمومی → نرمال‌سازی/ذخیره → تطبیق هوش مصنوعی.
 *
 * این ماژول تازه است و قراردادهای موجود را «استفاده» می‌کند، نه بازنویسی:
 *   • کانکتورها از طریق getConnector(...) از رجیستری (src/lib/apply/registry.ts) گرفته می‌شوند.
 *   • امتیازدهی/نگارش انگیزه‌نامه از scoreAndDraft(...) در src/lib/apply/scoring.ts می‌آید.
 * مرحله‌ی Integrate قرار است scrapePublic/scoreAndDraftِ واقعی را پشتِ همین امضاها
 * سیم‌کشی کند؛ تا آن زمان، اگر آن قراردادها هنوز «پیاده‌نشده» باشند، این لایه خطای
 * تمیزِ NotImplemented بالا می‌دهد تا مسیر API بتواند ۵۰۱ برگرداند (نه ۵۰۰ مبهم).
 *
 * هیچ احراز هویتی و هیچ اپلایِ واقعی‌ای اینجا نیست — صرفاً خواندنِ آگهی‌های عمومی و
 * تطبیق با پروفایلِ کاربر. ریسکِ حسابِ کاربری صفر است (مطابق فاز ۱ سند معماری).
 */
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  candidateProfiles,
  jobListings,
  matches,
  rawListings,
  tasks,
  type JobListingRow,
} from "@/db/schema";
// نکته‌ی Integrate: برای شکستنِ چرخه‌ی import (index → orchestrator → index)،
// مستقیماً از منبعِ هر وابستگی import می‌کنیم نه از بشکه‌ی @/lib/apply:
//   • getConnector از همان رجیستریِ index.ts (تابع است، در زمان اجرا صدا زده می‌شود)
//   • scoreAndDraft از @/lib/apply/scoring (پیاده‌سازیِ واقعیِ گیت‌وی 1xai)
// این کار رفتارِ زمان‌اجرا را تغییر نمی‌دهد، فقط ترتیبِ ارزیابیِ ماژول‌ها را امن می‌کند.
import { scoreAndDraft } from "@/lib/apply/scoring";
import { getConnector } from "@/lib/apply/registry";
import { enqueue as defaultEnqueue } from "@/lib/queue";
import type {
  CandidateProfile,
  JobBoardConnector,
  JobBoardId,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";
import { HttpError, NotImplementedError } from "@/lib/api/http";

/** آستانه‌ی پیش‌فرضِ «بالای آستانه» برای drafted-شدنِ یک تطبیق. */
const DEFAULT_SCORE_THRESHOLD = 0.6;

/** خلاصه‌ی یک اجرای ingest+match. */
export interface IngestRunResult {
  board: "jobinja";
  profileId: string;
  /** تعداد آگهی‌هایی که کانکتور برگرداند. */
  scraped: number;
  /** آگهی‌های تازه که برای اولین بار ذخیره شدند. */
  newListings: number;
  /** تطبیق‌هایی که امتیاز گرفتند (ساخته یا به‌روزشده). */
  scoredMatches: number;
  /** تطبیق‌های بالای آستانه که انگیزه‌نامه برایشان آماده شد. */
  draftedMatches: number;
  /** آگهی‌هایی که هنگام امتیازدهی‌شان خطا رخ داد (بدون شکست کل اجرا). */
  scoringErrors: number;
}

/** ورودیِ یک اجرا. */
export interface IngestRunInput {
  profileId: string;
  /** بازنویسیِ آستانه‌ی امتیاز (۰..۱). اگر داده نشود، پیش‌فرض استفاده می‌شود. */
  scoreThreshold?: number;
  /** سقفِ اختیاری روی تعداد آگهی‌هایی که در این اجرا امتیاز می‌گیرند. */
  limit?: number;
}

/** آیا این خطا از نوعِ «هنوز پیاده‌نشده»‌ی داربست است؟ */
function isNotImplemented(err: unknown): boolean {
  return err instanceof Error && /not implemented/i.test(err.message);
}

/**
 * یک اجرای ingest+match برای جابینجا روی یک پروفایلِ ذخیره‌شده.
 *
 * گام‌ها:
 *   ۱) پروفایل را از DB می‌خوانیم (۴۰۴ اگر نباشد).
 *   ۲) jobinja.scrapePublic(prefs) را صدا می‌زنیم (فقط-خواندنی).
 *   ۳) آگهی‌ها را نرمال/upsert می‌کنیم (jobListings + rawListings).
 *   ۴) برای هر آگهی، scoreAndDraft را صدا و match را upsert می‌کنیم.
 */
export async function runJobinjaIngest(input: IngestRunInput): Promise<IngestRunResult> {
  const threshold = input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

  // ۱) پروفایل و کاربرِ صاحبش.
  const profileRow = await db.query.candidateProfiles.findFirst({
    where: eq(candidateProfiles.id, input.profileId),
  });
  if (!profileRow) {
    throw new HttpError(404, "profile not found");
  }

  const connector = getConnector("jobinja");
  if (!connector) {
    throw new HttpError(500, "jobinja connector not registered");
  }

  const prefs = toJobPreferences(profileRow.preferences);
  const profile = toCandidateProfile(profileRow, prefs);

  // ۲) ingest عمومی. اگر کانکتور هنوز داربست است → NotImplemented (۵۰۱).
  let listings: JobListing[];
  try {
    listings = await connector.scrapePublic(prefs);
  } catch (err) {
    if (isNotImplemented(err)) {
      throw new NotImplementedError("jobinja public ingest not implemented yet");
    }
    throw err;
  }

  const result: IngestRunResult = {
    board: "jobinja",
    profileId: profileRow.id,
    scraped: listings.length,
    newListings: 0,
    scoredMatches: 0,
    draftedMatches: 0,
    scoringErrors: 0,
  };

  // سقفِ اختیاری برای جلوگیری از انفجارِ تعداد فراخوانیِ مدل در یک اجرا.
  const toProcess =
    typeof input.limit === "number" ? listings.slice(0, Math.max(0, input.limit)) : listings;

  for (const listing of toProcess) {
    // ۳) نرمال‌سازی/ذخیره‌ی آگهی + ضبط خام.
    const { row, isNew } = await upsertListing(listing);
    if (isNew) result.newListings += 1;

    // ۴) امتیازدهی + نگارشِ انگیزه‌نامه. خطای یک آگهی نباید کل اجرا را بشکند —
    //    مگر اینکه قراردادِ scoreAndDraft هنوز اصلاً پیاده نشده باشد (آن‌وقت ۵۰۱).
    try {
      const { matchScore, coverLetter } = await scoreAndDraft(listing, profile);
      const drafted = matchScore >= threshold;
      await upsertMatch({
        userId: profileRow.userId,
        listingId: row.id,
        score: matchScore,
        coverLetter: drafted ? coverLetter : null,
        status: drafted ? "drafted" : "scored",
      });
      result.scoredMatches += 1;
      if (drafted) result.draftedMatches += 1;
    } catch (err) {
      if (isNotImplemented(err)) {
        throw new NotImplementedError("AI scoring (scoreAndDraft) not implemented yet");
      }
      // خطای موردی روی یک آگهی: بشمار و ادامه بده.
      result.scoringErrors += 1;
      console.error(`[orchestrator] scoreAndDraft failed for ${listing.id}:`, err);
    }
  }

  return result;
}

/* ───────────────────────────  کمک‌کننده‌های نگاشت  ─────────────────────────── */

/** preferences ذخیره‌شده (jsonb) → JobPreferences نوع‌دارِ types.ts. */
function toJobPreferences(raw: Record<string, unknown> | null): JobPreferences {
  if (!raw || typeof raw !== "object") return {};
  const titles = Array.isArray(raw.titles) ? (raw.titles as string[]) : undefined;
  const cities = Array.isArray(raw.cities) ? (raw.cities as string[]) : undefined;
  const minSalary = typeof raw.minSalary === "number" ? raw.minSalary : undefined;
  const employmentTypes = Array.isArray(raw.employmentTypes)
    ? (raw.employmentTypes as JobPreferences["employmentTypes"])
    : undefined;
  return { titles, cities, minSalary, employmentTypes };
}

/** ردیفِ DBِ پروفایل → CandidateProfileِ قراردادِ دامنه. */
function toCandidateProfile(
  row: typeof candidateProfiles.$inferSelect,
  prefs: JobPreferences,
): CandidateProfile {
  return {
    fullName: row.fullName,
    headline: row.headline ?? undefined,
    skills: row.skills ?? [],
    yearsExperience: row.yearsExperience ?? undefined,
    city: row.city ?? undefined,
    resumeText: row.resumeText ?? undefined,
    preferences: prefs,
  };
}

/** آگهی نرمال‌شده را upsert می‌کند (بر اساس canonicalId) و خام را ضبط می‌کند. */
async function upsertListing(
  listing: JobListing,
): Promise<{ row: JobListingRow; isNew: boolean }> {
  const canonicalId = listing.id; // `${board}:${externalId}` طبق قرارداد types.ts

  const existing = await db.query.jobListings.findFirst({
    where: eq(jobListings.canonicalId, canonicalId),
  });

  const values = {
    board: listing.board as "jobinja",
    externalId: listing.externalId,
    canonicalId,
    title: listing.title,
    company: listing.company ?? null,
    city: listing.city ?? null,
    url: listing.url,
    description: listing.description ?? null,
    salary: listing.salary ?? null,
    postedAt: listing.postedAt ? new Date(listing.postedAt) : null,
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(jobListings)
    .values(values)
    .onConflictDoUpdate({
      target: jobListings.canonicalId,
      set: {
        title: values.title,
        company: values.company,
        city: values.city,
        url: values.url,
        description: values.description,
        salary: values.salary,
        postedAt: values.postedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  // ضبطِ خام برای بازپخش/دیباگ (best-effort؛ خطایش اجرا را نمی‌شکند).
  try {
    await db.insert(rawListings).values({
      board: listing.board as "jobinja",
      externalId: listing.externalId,
      payload: listing as unknown as Record<string, unknown>,
      listingId: row.id,
    });
  } catch (err) {
    console.error(`[orchestrator] raw capture failed for ${canonicalId}:`, err);
  }

  return { row, isNew: !existing };
}

/** تطبیق (کاربر × آگهی) را upsert می‌کند — یکتا روی (userId, listingId). */
async function upsertMatch(args: {
  userId: string;
  listingId: string;
  score: number;
  coverLetter: string | null;
  status: "scored" | "drafted";
}): Promise<void> {
  const now = new Date();
  await db
    .insert(matches)
    .values({
      userId: args.userId,
      listingId: args.listingId,
      score: args.score,
      status: args.status,
      coverLetter: args.coverLetter,
      scoredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [matches.userId, matches.listingId],
      set: {
        score: args.score,
        status: args.status,
        coverLetter: args.coverLetter,
        scoredAt: now,
        updatedAt: now,
      },
    });
}

/** صادراتِ کمکی برای مصرف‌کننده‌های دیگر/تست. */
export { DEFAULT_SCORE_THRESHOLD };

/* ════════════════════════════════════════════════════════════════════════
 *  runAutoApply — خطِ لوله‌ی کاملِ کنترل‌پلین (ingest → score → match → queue)
 *
 *  این بخش، گردش‌کارِ بخش ۳ سند معماری را پیاده می‌کند: علاوه بر ingest و
 *  امتیازدهی (که runJobinjaIngest بالا برای فاز ۱ انجام می‌دهد)، تطبیق‌های بالای
 *  آستانه را به‌صورت idempotent وارد *صفِ اپلای* (جدول tasks) می‌کند.
 *
 *  مرزِ ایمنیِ کلیدی: این تابع خودش *هرگز اپلای را ارسال نمی‌کند*. ارسالِ واقعی کارِ
 *  کارگر/افزونه است (بخش ۲ سند). ارکستریتور فقط کشف، امتیازدهی و صف‌گذاری می‌کند.
 *
 *  قواعدِ ایمنیِ اعمال‌شده:
 *    • dedupe — UNIQUE(matches.user_id, listing_id) + idempotencyKey=`apply:${matchId}`
 *      → یک آگهی هرگز دوبار برای یک کاربر وارد صف نمی‌شود (حتی در re-run).
 *    • سقفِ روزانه — حداکثر تعداد اپلایِ صف‌شده در هر روز برای هر کاربر.
 *    • آستانه — فقط امتیازِ ≥ threshold وارد صف می‌شود.
 *  همه‌ی وابستگی‌ها قابلِ تزریق‌اند تا بدون DB/شبکه‌ی زنده تست شوند.
 * ════════════════════════════════════════════════════════════════════════ */

/** آستانه‌ی پیش‌فرضِ ورود به صفِ اپلای. */
export const DEFAULT_MATCH_THRESHOLD = 0.7;
/** سقفِ پیش‌فرضِ اپلای روزانه به‌ازای هر کاربر (throttle/anti-ban، بخش ۴ سند). */
export const DEFAULT_DAILY_CAP = 20;

/** نوعِ تابعِ امتیازدهی که runAutoApply به آن وابسته است. */
export type ScoreAndDraftFn = (
  job: JobListing,
  profile: CandidateProfile,
) => Promise<{ matchScore: number; coverLetter: string; reason?: string }>;

/** نوعِ تابعِ enqueueِ صف (برای تزریق در تست). */
export type EnqueueFn = typeof defaultEnqueue;

/** هندلِ کمینه‌ی DB که این خطِ لوله لازم دارد (همان کلاینتِ Drizzle). */
export type OrchestratorDb = typeof db;

/** ورودی‌ها و وابستگی‌های قابلِ‌تزریقِ یک اجرای runAutoApply. */
export interface RunAutoApplyOptions {
  /** شناسه‌ی کاربرِ صاحبِ این اجرا (برای matches/tasks لازم است). */
  userId: string;
  /** سایت‌هایی که باید ingest شوند. */
  boards: JobBoardId[];
  /** آستانه‌ی امتیاز (پیش‌فرض ۰٫۷). */
  threshold?: number;
  /** سقفِ اپلایِ صف‌شده در این اجرا/روز (پیش‌فرض ۲۰). */
  dailyCap?: number;
  /** رجیستریِ کانکتورها — تزریقی برای تست؛ پیش‌فرض از getConnector. */
  connectors?: Partial<Record<JobBoardId, JobBoardConnector>>;
  /** تابعِ امتیازدهی — پیش‌فرض scoreAndDraft از @/lib/apply. */
  scoreFn?: ScoreAndDraftFn;
  /** کلاینتِ DB — پیش‌فرض dbِ مشترک. */
  db?: OrchestratorDb;
  /** تابعِ enqueue — پیش‌فرض از @/lib/queue. */
  enqueueFn?: EnqueueFn;
}

/** خلاصه‌ی نتیجه‌ی یک اجرای runAutoApply — برای داشبورد/لاگ. */
export interface RunAutoApplyReport {
  ingested: number;
  persistedListings: number;
  scored: number;
  matchedAboveThreshold: number;
  queued: number;
  /** تطبیق‌هایی که به‌خاطر رسیدن به سقفِ روزانه وارد صف نشدند. */
  skippedByCap: number;
  errors: string[];
}

/** پیامِ خطای امن از یک unknown. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * upsertِ یک آگهیِ نرمال‌شده روی هندلِ تزریق‌شده (نه dbِ سراسری) — تا runAutoApply
 * کاملاً قابلِ تست بماند. روی برخوردِ canonicalId به‌روزرسانی می‌کند و ردیف را
 * برمی‌گرداند؛ سپس ضبطِ خام در raw_listings (best-effort).
 */
async function persistListingWith(
  conn: OrchestratorDb,
  job: JobListing,
): Promise<JobListingRow> {
  const canonical = job.id; // `${board}:${externalId}` طبق قراردادِ types.ts
  const [row] = await conn
    .insert(jobListings)
    .values({
      board: job.board as "jobinja",
      externalId: job.externalId,
      canonicalId: canonical,
      title: job.title,
      company: job.company ?? null,
      city: job.city ?? null,
      url: job.url,
      description: job.description ?? null,
      salary: job.salary ?? null,
      postedAt: job.postedAt ? new Date(job.postedAt) : null,
    })
    .onConflictDoUpdate({
      target: jobListings.canonicalId,
      set: {
        title: sql`excluded.title`,
        company: sql`excluded.company`,
        city: sql`excluded.city`,
        url: sql`excluded.url`,
        description: sql`excluded.description`,
        salary: sql`excluded.salary`,
        postedAt: sql`excluded.posted_at`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  try {
    await conn.insert(rawListings).values({
      board: job.board as "jobinja",
      externalId: job.externalId,
      payload: job as unknown as Record<string, unknown>,
      listingId: row.id,
    });
  } catch (err) {
    console.error(`[orchestrator] raw capture failed for ${canonical}:`, err);
  }

  return row;
}

/**
 * شمارشِ اپلای‌هایی که امروز برای این کاربر وارد صف شده‌اند — مبنای سقفِ روزانه.
 *
 * مبنا را «رویدادِ صف» می‌گیریم نه matches.updatedAt: هر ورود به صف دقیقاً یک ردیفِ
 * tasks می‌سازد و tasks.created_at تغییرناپذیر است. (matches.updatedAt با هر
 * re-score بازنویسی می‌شد و «queued today» را نادرست می‌شمرد — رفعِ یافته‌ی ممیزی.)
 * مرزِ روز سمتِ DB با date_trunc('day', now()) حساب می‌شود.
 */
async function countQueuedToday(
  conn: OrchestratorDb,
  userId: string,
): Promise<number> {
  const rows = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .innerJoin(matches, eq(tasks.matchId, matches.id))
    .where(
      and(
        eq(matches.userId, userId),
        gte(tasks.createdAt, sql`date_trunc('day', now())`),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * گردش‌کارِ اپلای خودکار را برای یک کاربر اجرا می‌کند:
 *   ingest (scrapePublic) → persist listing → score (scoreAndDraft) →
 *   upsert match → enqueue Application task (idempotent، بالای آستانه، زیرِ سقف).
 *
 * اپلایِ واقعی انجام *نمی‌شود* — صرفاً صف‌گذاری.
 */
export async function runAutoApply(
  profile: CandidateProfile,
  options: RunAutoApplyOptions,
): Promise<RunAutoApplyReport> {
  const {
    userId,
    boards,
    threshold = DEFAULT_MATCH_THRESHOLD,
    dailyCap = DEFAULT_DAILY_CAP,
    scoreFn = scoreAndDraft,
    db: conn = db,
    enqueueFn = defaultEnqueue,
  } = options;

  // رجیستریِ کانکتور: تزریقی یا از getConnector.
  const resolveConnector = (id: JobBoardId): JobBoardConnector | undefined =>
    options.connectors ? options.connectors[id] : getConnector(id);

  const report: RunAutoApplyReport = {
    ingested: 0,
    persistedListings: 0,
    scored: 0,
    matchedAboveThreshold: 0,
    queued: 0,
    skippedByCap: 0,
    errors: [],
  };

  // سقفِ روزانه: ظرفیتِ باقی‌مانده.
  let remainingCap = Math.max(0, dailyCap - (await countQueuedToday(conn, userId)));

  const prefs = profile.preferences ?? {};

  for (const boardId of boards) {
    const connector = resolveConnector(boardId);
    if (!connector) {
      report.errors.push(`کانکتور برای سایت ${boardId} ثبت نشده است`);
      continue;
    }

    // ۱) ingestِ عمومی (فقط-خواندنی).
    let listings: JobListing[];
    try {
      listings = await connector.scrapePublic(prefs);
    } catch (err) {
      report.errors.push(`scrapePublic(${boardId}): ${errMsg(err)}`);
      continue;
    }
    report.ingested += listings.length;

    for (const job of listings) {
      // ۲) پایدارسازیِ آگهی (upsert + ضبطِ خام) روی هندلِ تزریق‌شده.
      let listingRow: JobListingRow;
      try {
        listingRow = await persistListingWith(conn, job);
        report.persistedListings += 1;
      } catch (err) {
        report.errors.push(`persistListing(${job.id}): ${errMsg(err)}`);
        continue;
      }

      // ۳) امتیازدهیِ هوش مصنوعی.
      let score: { matchScore: number; coverLetter: string; reason?: string };
      try {
        score = await scoreFn(job, profile);
        report.scored += 1;
      } catch (err) {
        report.errors.push(`scoreAndDraft(${job.id}): ${errMsg(err)}`);
        continue;
      }

      const aboveThreshold = score.matchScore >= threshold;

      // ۴) upsertِ تطبیق. وضعیت: زیرِ آستانه → 'scored'، بالای آستانه → 'drafted'.
      //    اگر در re-run قبلاً 'queued'/'dismissed' شده باشد، آن را پاس می‌داریم.
      let matchId: string;
      let matchStatus: string;
      try {
        const [matchRow] = await conn
          .insert(matches)
          .values({
            userId,
            listingId: listingRow.id,
            score: score.matchScore,
            status: aboveThreshold ? "drafted" : "scored",
            reason: score.reason ?? null,
            coverLetter: aboveThreshold ? score.coverLetter : null,
            scoredAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: [matches.userId, matches.listingId],
            set: {
              score: sql`excluded.score`,
              reason: sql`excluded.reason`,
              coverLetter: sql`excluded.cover_letter`,
              status: sql`CASE WHEN ${matches.status} IN ('queued','dismissed')
                               THEN ${matches.status}
                               ELSE excluded.status END`,
              scoredAt: sql`now()`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: matches.id, status: matches.status });
        matchId = matchRow.id;
        matchStatus = matchRow.status;
      } catch (err) {
        report.errors.push(`persistMatch(${job.id}): ${errMsg(err)}`);
        continue;
      }

      if (!aboveThreshold) continue;
      report.matchedAboveThreshold += 1;

      // dedupe: اگر قبلاً وارد صف شده یا کاربر ردش کرده، دوباره صف نکن.
      if (matchStatus === "queued" || matchStatus === "dismissed") continue;

      // سقفِ روزانه.
      if (remainingCap <= 0) {
        report.skippedByCap += 1;
        continue;
      }

      // ۵) ورود به صف (idempotent via idempotencyKey).
      try {
        const { created } = await enqueueFn(
          {
            idempotencyKey: `apply:${matchId}`,
            matchId,
            payload: {
              board: job.board,
              listingId: listingRow.id,
              coverLetter: score.coverLetter,
              matchScore: score.matchScore,
            },
          },
          conn as unknown as Parameters<EnqueueFn>[1],
        );

        // تطبیق را به 'queued' ببر تا dedupe در re-runها و شمارشِ سقف درست بماند.
        await conn
          .update(matches)
          .set({ status: "queued", updatedAt: sql`now()` })
          .where(eq(matches.id, matchId));

        if (created) {
          report.queued += 1;
          remainingCap -= 1;
        }
      } catch (err) {
        report.errors.push(`enqueue(apply:${matchId}): ${errMsg(err)}`);
        continue;
      }
    }
  }

  return report;
}
