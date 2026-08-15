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
import {
  isInsufficientBalance,
  meteredScoreAndDraft,
  meteredScoreOnly,
} from "@/lib/apply/metered-scoring";
import { toJobPreferences as preferencesToJobPreferences } from "@/lib/apply/filters";
import {
  advanceFilterCursor,
  computeFilterSignature,
  readFilterCursor,
} from "@/lib/apply/filter-cursor";
import { getConnector, isBoardLive, liveBoardIds } from "@/lib/apply/registry";
import { sanitizePgText } from "@/lib/apply/pg-text";
import { orchestratorRunCap } from "@/lib/env";
import { enqueue as defaultEnqueue } from "@/lib/queue";
import type {
  CandidateProfile,
  JobBoardConnector,
  JobBoardId,
  JobListing,
  JobPreferences,
} from "@/lib/apply/types";
import { HttpError, NotImplementedError } from "@/lib/api/http";

/** مکثِ کوتاه (برای تلاشِ دوباره‌ی نوشتنِ گذرا). */
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** تلاش‌های نوشتنِ تطبیقِ امتیازخورده — امتیازِ *پرداخت‌شده به 1xai* نباید با یک خطای گذرای
 *  DBِ محلی هدر رود و در اجرای بعد دوباره شارژ شود. */
const MATCH_UPSERT_ATTEMPTS = 3;
const MATCH_UPSERT_RETRY_MS = 100;

/** آستانه‌ی پیش‌فرضِ «بالای آستانه» برای drafted-شدنِ یک تطبیق. */
const DEFAULT_SCORE_THRESHOLD = 0.6;
const MAX_JOB_POSTED_AGE_DAYS = 45;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  /**
   * تابعِ امتیازدهی — تزریقی برای تست. در مسیرِ تولید خالی می‌ماند و به‌صورتِ پیش‌فرض
   * نسخه‌ی *مترشده‌ی* scoreAndDraft (مقید به کاربرِ صاحبِ پروفایل) استفاده می‌شود تا
   * هزینه‌ی هر فراخوانیِ تطبیق به کیف‌پولِ همان کاربر بسته شود.
   */
  scoreFn?: ScoreAndDraftFn;
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

  // مسیرِ تولید: امتیازدهیِ *مترشده* مقید به کاربرِ صاحبِ پروفایل (هزینه به کیف‌پولِ او).
  // تست می‌تواند scoreFn را تزریق کند تا بدونِ بیلینگ/گیت‌وی اجرا شود.
  const scoreFn: ScoreAndDraftFn =
    input.scoreFn ?? ((job, prof) => defaultScoreFn(profileRow.userId, job, prof));

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

  // سقفِ runaway: همیشه حداکثر orchestratorRunCap() آگهی در یک اجرا پردازش می‌شود تا
  // یک اجرا نتواند بی‌حدومرز فراخوانیِ مدل بزند. limitِ صریحِ فراخواننده فقط می‌تواند این
  // سقف را *کمتر* کند، نه بیشتر.
  const runCap = orchestratorRunCap();
  const effectiveLimit =
    typeof input.limit === "number" ? Math.min(Math.max(0, input.limit), runCap) : runCap;
  const toProcess = listings.slice(0, effectiveLimit);

  for (const candidate of toProcess) {
    const listing = await freshJobForProcessing(candidate);
    if (!listing) continue;
    if (!matchesCandidateGender(listing, prefs)) continue;

    // ۳) نرمال‌سازی/ذخیره‌ی آگهی + ضبط خام.
    const { row, isNew } = await upsertListing(listing);
    if (isNew) result.newListings += 1;

    // ۴) امتیازدهی + نگارشِ انگیزه‌نامه. خطای یک آگهی نباید کل اجرا را بشکند —
    //    مگر اینکه قراردادِ scoreAndDraft هنوز اصلاً پیاده نشده باشد (آن‌وقت ۵۰۱).
    try {
      const { matchScore, coverLetter } = await scoreFn(listing, profile);
      const drafted = matchScore >= threshold;
      await upsertMatch({
        userId: profileRow.userId,
        listingId: row.id,
        score: matchScore,
        coverLetter: drafted && listing.board !== "jobinja" ? coverLetter : null,
        status: drafted ? "drafted" : "scored",
      });
      result.scoredMatches += 1;
      if (drafted) result.draftedMatches += 1;
    } catch (err) {
      if (isNotImplemented(err)) {
        throw new NotImplementedError("AI scoring (scoreAndDraft) not implemented yet");
      }
      // موجودیِ هوش مصنوعی تمام شد → کلِ اجرا را متوقف کن؛ وگرنه هر آگهیِ بعدی یک
      // فراخوانیِ گیت‌ویِ بی‌محاسبه می‌سازد (نشتِ هزینه‌ی بالادست). نتیجه‌ی جزئی برمی‌گردد.
      if (isInsufficientBalance(err)) {
        console.warn("[orchestrator] موجودیِ هوش مصنوعی تمام شد؛ اجرا متوقف شد.");
        break;
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
    postedAt: toPostedDate(listing.postedAt),
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
 *  ورکر/افزونه است (بخش ۲ سند). ارکستریتور فقط کشف، امتیازدهی و صف‌گذاری می‌کند.
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
  /**
   * سقفِ تعدادِ آگهیِ پردازش‌شده در هر سایت در این اجرا (گاردریلِ runaway). پیش‌فرض
   * orchestratorRunCap() از env (۲۵). آگهی‌های بیشتر از این در همان اجرا نادیده می‌مانند.
   */
  perRunListingCap?: number;
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
 * `JobListing.postedAt` قراردادِ فرمتِ ISO ندارد (types.ts) و کانکتورها آن را به‌صورتِ
 * متنِ انسانیِ نسبی برمی‌گردانند (مثلِ «امروز» یا «۳ روز پیش»). `new Date()` روی چنین
 * رشته‌ای `Invalid Date` می‌سازد و درایزل هنگامِ سریال‌سازیِ ستونِ timestamp با
 * `RangeError: Invalid time value` می‌شکند — که کلِ ingestِ فیلترمود را از کار می‌انداخت.
 * این کمک‌تابع فقط وقتی `Date` می‌سازد که مقدار به یک زمانِ معتبر پارس شود؛ در غیرِ این
 * صورت `null` (ستونِ postedAt خالی می‌ماند؛ `ingestedAt` همچنان ثبت می‌شود).
 */
function toPostedDate(raw?: string | Date | null): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  const relative = relativePostedDate(raw);
  if (relative) return relative;

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeDigits(input: string): string {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const faIdx = fa.indexOf(ch);
    if (faIdx >= 0) return String(faIdx);
    const arIdx = ar.indexOf(ch);
    return arIdx >= 0 ? String(arIdx) : ch;
  });
}

function relativePostedDate(raw: string, now = new Date()): Date | null {
  const text = normalizeDigits(raw).replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  let days: number | null = null;
  if (/^(امروز|today)$/i.test(text)) days = 0;
  else if (/^(دیروز|yesterday)$/i.test(text)) days = 1;
  else {
    const match = /(\d+)\s*(روز|day|days|هفته|week|weeks|ماه|month|months)\s*(?:پیش|ago)?/i.exec(text);
    if (match) {
      const n = Number(match[1]);
      const unit = match[2];
      if (Number.isFinite(n)) {
        if (/روز|day/i.test(unit)) days = n;
        else if (/هفته|week/i.test(unit)) days = n * 7;
        else if (/ماه|month/i.test(unit)) days = n * 30;
      }
    }
  }
  if (days === null) return null;
  return new Date(now.getTime() - days * MS_PER_DAY);
}

function isFreshJobPosting(job: JobListing, now = new Date()): boolean {
  const posted = toPostedDate(job.postedAt);
  if (!posted) return false;
  return posted.getTime() >= now.getTime() - MAX_JOB_POSTED_AGE_DAYS * MS_PER_DAY;
}

function normalizedJobText(job: JobListing): string {
  return `${job.title}\n${job.description ?? ""}\n${job.url}`.toLowerCase();
}

function isFemaleOnlyJob(job: JobListing): boolean {
  const text = normalizedJobText(job);
  return (
    /(^|[\s(（\\/،؛:-])خانم($|[\s)）\\/،؛:-])/.test(text) ||
    /جنسیت[^\n]{0,40}خانم/.test(text) ||
    /(?:female|woman|women)\s*[- ]?\s*only/.test(text) ||
    /\bonly\s+(?:female|woman|women)\b/.test(text)
  );
}

function isMaleOnlyJob(job: JobListing): boolean {
  const text = normalizedJobText(job);
  return (
    /(^|[\s(（\\/،؛:-])آقا($|[\s)）\\/،؛:-])/.test(text) ||
    /جنسیت[^\n]{0,40}آقا/.test(text) ||
    /(?:male|man|men)\s*[- ]?\s*only/.test(text) ||
    /\bonly\s+(?:male|man|men)\b/.test(text)
  );
}

function matchesCandidateGender(job: JobListing, prefs?: JobPreferences): boolean {
  if (prefs?.gender === "male") return !isFemaleOnlyJob(job);
  if (prefs?.gender === "female") return !isMaleOnlyJob(job);
  return true;
}

function defaultScoreFn(
  userId: string,
  job: JobListing,
  profile: CandidateProfile,
): Promise<{ matchScore: number; coverLetter: string; reason?: string }> {
  return job.board === "jobinja"
    ? meteredScoreOnly(userId, job, profile)
    : meteredScoreAndDraft(userId, job, profile);
}

async function enrichJobinjaMeta(job: JobListing): Promise<JobListing> {
  if (job.board !== "jobinja" || !job.url) return job;
  if (process.env.NODE_ENV === "test") return job;
  if (toPostedDate(job.postedAt) && job.description) return job;
  try {
    const { fetchJobMeta } = await import("@/lib/apply/boards/jobinja");
    const meta = await fetchJobMeta(job.url);
    return {
      ...job,
      ...(meta.description && !job.description ? { description: meta.description } : {}),
      ...(meta.postedAt && !toPostedDate(job.postedAt)
        ? { postedAt: meta.postedAt.toISOString() }
        : {}),
    };
  } catch {
    return job;
  }
}

async function freshJobForProcessing(job: JobListing): Promise<JobListing | null> {
  const enriched = await enrichJobinjaMeta(job);
  return isFreshJobPosting(enriched) ? enriched : null;
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
      postedAt: toPostedDate(job.postedAt),
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

async function countQueuedThisWeek(
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
        gte(tasks.createdAt, sql`date_trunc('week', now())`),
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
    db: conn = db,
    enqueueFn = defaultEnqueue,
    perRunListingCap = orchestratorRunCap(),
  } = options;

  // مسیرِ تولید: اگر scoreFn تزریق نشده، نسخه‌ی *مترشده* مقید به userId استفاده می‌شود
  // تا هزینه‌ی هر فراخوانیِ تطبیق به کیف‌پولِ همین کاربر بسته شود (مدلِ بیلینگِ قفل‌شده).
  // تست‌ها همیشه scoreFn را تزریق می‌کنند و رفتارشان دست‌نخورده می‌ماند.
  const scoreFn: ScoreAndDraftFn =
    options.scoreFn ?? ((job, prof) => defaultScoreFn(userId, job, prof));

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

  boardsLoop: for (const boardId of boards) {
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

    // سقفِ runaway: حداکثر perRunListingCap آگهی در هر سایت در این اجرا پردازش می‌شود.
    const capped = listings.slice(0, Math.max(0, perRunListingCap));

    for (const candidate of capped) {
      const job = await freshJobForProcessing(candidate);
      if (!job) continue;
      if (!matchesCandidateGender(job, profile.preferences)) continue;

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
        // اتمامِ موجودی → کلِ اجرا را متوقف کن (break از حلقه‌ی برچسب‌دارِ سایت‌ها)، تا
        // آگهی‌های بعدی فراخوانیِ گیت‌ویِ بی‌محاسبه نسازند. نتیجه‌ی جزئی برمی‌گردد.
        if (isInsufficientBalance(err)) {
          report.errors.push("اجرا به‌خاطرِ اتمامِ موجودیِ هوش مصنوعی متوقف شد");
          break boardsLoop;
        }
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
            coverLetter: aboveThreshold && job.board !== "jobinja" ? score.coverLetter : null,
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
              ...(job.board !== "jobinja" && score.coverLetter ? { coverLetter: score.coverLetter } : {}),
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

/* ════════════════════════════════════════════════════════════════════════
 *  runFilterApply — مسیرِ «فیلترمود» (پیوُت محصول): اپلای به همه‌ی آگهی‌های
 *  فیلترشده‌ی خودِ سایت، بدونِ نیاز به هوش مصنوعی.
 *
 *  تفاوتِ کلیدی با runAutoApply:
 *    • فیلترمود (aiFilter=false، پیش‌فرض): *هر* آگهیِ برگشتی از scrapePublic بدونِ
 *      امتیازدهی وارد صف می‌شود. taskها با payload.mode='filter' برچسب می‌خورند تا
 *      claimِ افزونه بدونِ گیتِ آستانه آن‌ها را بردارد (extension-queue).
 *    • فیلترِ هوشمند (aiFilter=true، پریمیوم): مثلِ مسیرِ AI، هر آگهی امتیاز می‌گیرد و
 *      فقط بالای آستانه وارد صف می‌شود (taskها payload.mode='ai' — گیتِ آستانه اعمال).
 *      استحقاق (assertCanUsePaidAi/پلن) را *فراخواننده* (Track C) پیش از aiFilter=true
 *      چک می‌کند؛ اینجا فقط سازوکار است. scoreFnِ پیش‌فرض مترشده است (هزینه به کیف‌پولِ
 *      همان کاربر).
 *
 *  ایمنی: هرگز connector.apply صدا نمی‌شود (فقط کشف + صف‌گذاری). idempotent per listing
 *  (idempotencyKey=`apply:${matchId}` روی جفتِ یکتای (user, listing))؛ سقفِ روزانه رعایت
 *  می‌شود؛ آگهیِ dismissed دوباره صف نمی‌شود. همه‌ی وابستگی‌ها تزریق‌پذیرند.
 * ════════════════════════════════════════════════════════════════════════ */

/** سقفِ پیش‌فرضِ روزانه‌ی فیلترمود (هم‌راستا با سهمیه‌ی اپلای رایگان ۱۰۰/روز). */
export const DEFAULT_FILTER_DAILY_CAP = 100;

/**
 * سقفِ صفحه‌ی پنجره‌ی برداشت در هر اجرا (گاردِ ادب/runaway). با `targetCount` عملاً زودتر
 * می‌ایستیم؛ این فقط بیشینه‌ی مطلقِ صفحه‌های یک اجراست.
 *
 * از ۵ به ۱۲ رسید: هر صفحه ~۲۰ آگهی، پس هر دور حداکثر ~۲۴۰ آگهی می‌بیند به‌جای ~۱۰۰.
 * مکان‌نمای هر کاربر (filter_cursors) بینِ دورها جلو می‌رود، پس این «سرعتِ پوشش» است نه
 * سقفِ کل — ولی با کرونِ هر ۱۰ دقیقه، تفاوتِ ۵ و ۱۲ یعنی چند برابر شدنِ تطبیق‌های روزانه.
 * ادب حفظ می‌شود: مکثِ ۱٫۲ ثانیه‌ای بینِ صفحه‌ها و بررسیِ robots سرِ جایش است.
 */
export const FILTER_SCRAPE_MAX_PAGES = 12;

/** قراردادِ برداشتِ صفحه‌بندی‌شده (افزونه‌ی کانکتور؛ فعلاً فقط jobinja آن را دارد). */
interface PagedScrape {
  scrapePublicWith(
    prefs: JobPreferences,
    opts: {
      startPage?: number;
      maxPages?: number;
      targetCount?: number;
      stopWhenStaleDays?: number;
    },
  ): Promise<{ listings: JobListing[]; pagesFetched: number; reachedEnd: boolean }>;
}

/** آیا این کانکتور برداشتِ صفحه‌بندی‌شده (مکان‌نما) را پشتیبانی می‌کند؟ */
function supportsPagedScrape(c: JobBoardConnector): c is JobBoardConnector & PagedScrape {
  return typeof (c as Partial<PagedScrape>).scrapePublicWith === "function";
}

/** پروفایل + ترجیحاتِ بارگذاری‌شده‌ی یک کاربر (ورودیِ داخلیِ فیلترمود). */
export interface LoadedFilterProfile {
  profile: CandidateProfile;
  prefs: JobPreferences;
}

/** ورودی‌ها و وابستگی‌های قابلِ تزریقِ یک اجرای runFilterApply. */
export interface RunFilterApplyOptions {
  /** کاربرِ صاحبِ این اجرا (همیشه از نشست، نه از بدنه — قاعده‌ی ۴). */
  userId: string;
  /** سایت‌هایی که باید ingest شوند (پیش‌فرض ['jobinja']). */
  boards?: JobBoardId[];
  /**
   * فیلترِ هوشمند (پریمیوم): اگر true، آگهی‌ها AI-score می‌شوند و فقط بالای آستانه صف
   * می‌شوند. پیش‌فرض false → *همه* صف می‌شوند (بدونِ AI). استحقاقِ پریمیوم را فراخواننده
   * پیش از این چک می‌کند.
   */
  aiFilter?: boolean;
  /** آستانه‌ی امتیاز در حالتِ aiFilter (پیش‌فرض ۰٫۷). */
  threshold?: number;
  /** سقفِ اپلایِ صف‌شده در این روز برای این کاربر (پیش‌فرض ۱۰۰). */
  dailyCap?: number;
  /** سقفِ تعدادِ آگهیِ پردازش‌شده در هر سایت در این اجرا (گاردریلِ runaway). */
  perRunListingCap?: number;
  /** رجیستریِ کانکتورها — تزریقی برای تست؛ پیش‌فرض از getConnector. */
  connectors?: Partial<Record<JobBoardId, JobBoardConnector>>;
  /** تابعِ امتیازدهی (فقط در aiFilter) — پیش‌فرض نسخه‌ی مترشده مقید به userId. */
  scoreFn?: ScoreAndDraftFn;
  /** کلاینتِ DB — پیش‌فرض dbِ مشترک. */
  db?: OrchestratorDb;
  /** تابعِ enqueue — پیش‌فرض از @/lib/queue. */
  enqueueFn?: EnqueueFn;
  /** بارگذارِ پروفایل — تزریقی برای تست؛ پیش‌فرض خواندنِ candidate_profiles با userId. */
  loadProfile?: (
    userId: string,
    conn: OrchestratorDb,
  ) => Promise<LoadedFilterProfile | null>;
  /** خواندنِ مکان‌نمای صفحه‌بندی — تزریقی برای تست؛ پیش‌فرض readFilterCursor. */
  readCursorFn?: (
    conn: OrchestratorDb,
    userId: string,
    board: string,
    filterSig: string,
  ) => Promise<number>;
  /** جلوبردنِ مکان‌نما — تزریقی برای تست؛ پیش‌فرض advanceFilterCursor. */
  advanceCursorFn?: (
    conn: OrchestratorDb,
    userId: string,
    board: string,
    filterSig: string,
    nextPage: number,
  ) => Promise<void>;
}

/** خلاصه‌ی نتیجه‌ی یک اجرای runFilterApply. */
export interface RunFilterApplyReport {
  /** آیا فیلترِ هوشمند (AI) فعال بود؟ */
  aiFilter: boolean;
  /** تعداد آگهی‌هایی که کانکتور(ها) برگرداندند. */
  ingested: number;
  /** آگهی‌های پایدارشده (upsert). */
  persistedListings: number;
  /** اپلای‌های *تازه* که در این اجرا وارد صف شدند (شمارشِ اصلیِ خروجی). */
  queued: number;
  /** آگهی‌هایی که از قبل در صف بودند (idempotent skip). */
  alreadyQueued: number;
  /** آگهی‌هایی که به‌خاطر سقفِ روزانه صف نشدند. */
  skippedByCap: number;
  /** آگهی‌هایی که کاربر قبلاً ردشان کرده بود (dismissed). */
  skippedDismissed: number;
  /** (فقط aiFilter) تعداد آگهی‌های امتیازخورده. */
  scored: number;
  /** (فقط aiFilter) آگهی‌های زیرِ آستانه که صف نشدند. */
  belowThreshold: number;
  /**
   * آیا برداشت به انتهای نتایجِ سایتِ زنده رسید (مکان‌نما به صفحه‌ی ۱ بازنشانی شد)؟ برای
   * چند-سایته، مقدارِ آخرین سایتِ پردازش‌شده. فعلاً فقط jobinja زنده است.
   */
  reachedEnd: boolean;
  errors: string[];
}

/** بارگذارِ پیش‌فرضِ پروفایل: candidate_profiles را با userId می‌خواند. */
async function defaultLoadFilterProfile(
  userId: string,
  conn: OrchestratorDb,
): Promise<LoadedFilterProfile | null> {
  const row = await conn.query.candidateProfiles.findFirst({
    where: eq(candidateProfiles.userId, userId),
  });
  if (!row) return null;
  const prefs = preferencesToJobPreferences(row.preferences);
  const profile = toCandidateProfile(row, prefs);
  return { profile, prefs };
}

/**
 * گردش‌کارِ «فیلترمود» را برای یک کاربر اجرا می‌کند:
 *   scrapePublic(prefs) → persist listing → [aiFilter? score+threshold] →
 *   upsert match → enqueue Application task (idempotent، زیرِ سقفِ روزانه).
 *
 * اپلایِ واقعی انجام *نمی‌شود* — صرفاً صف‌گذاری. `queued` تعداد اپلای‌های تازه است.
 */
export async function runFilterApply(
  options: RunFilterApplyOptions,
): Promise<RunFilterApplyReport> {
  const {
    userId,
    boards = liveBoardIds(),
    aiFilter = false,
    threshold = DEFAULT_MATCH_THRESHOLD,
    dailyCap = DEFAULT_FILTER_DAILY_CAP,
    db: conn = db,
    enqueueFn = defaultEnqueue,
    perRunListingCap = orchestratorRunCap(),
    readCursorFn = readFilterCursor,
    advanceCursorFn = advanceFilterCursor,
  } = options;

  const loadProfile = options.loadProfile ?? defaultLoadFilterProfile;
  const loaded = await loadProfile(userId, conn);
  if (!loaded) {
    // بدونِ پروفایل، فیلتری برای اپلای وجود ندارد. ۴۰۴ تمیز تا route بتواند پیام دهد.
    throw new HttpError(404, "profile not found");
  }
  const { profile, prefs } = loaded;

  // مسیرِ تولید: scoreFnِ مترشده مقید به userId (هزینه به کیف‌پولِ همان کاربر). فقط در aiFilter.
  const scoreFn: ScoreAndDraftFn =
    options.scoreFn ?? ((job, prof) => defaultScoreFn(userId, job, prof));

  const resolveConnector = (id: JobBoardId): JobBoardConnector | undefined =>
    options.connectors ? options.connectors[id] : getConnector(id);

  const report: RunFilterApplyReport = {
    aiFilter,
    ingested: 0,
    persistedListings: 0,
    queued: 0,
    alreadyQueued: 0,
    skippedByCap: 0,
    skippedDismissed: 0,
    scored: 0,
    belowThreshold: 0,
    reachedEnd: false,
    errors: [],
  };

  if (prefs.paused) return report;

  // دفاع در عمق: بدونِ هیچ فیلترِ هدف‌گیری (دسته/شهر/نوع/عنوان/دورکاری)، scrapePublic به
  // /jobsِ خام می‌رسد و تازه‌ترین‌های کلِ سایت را برمی‌گرداند → اپلای انبوهِ ناخواسته به
  // شغل‌های نامرتبط. پس اگر هیچ هدفی نیست، هیچ‌چیز صف نکن و گزارشِ خالی برگردان.
  const hasTargeting = Boolean(
    prefs.categorySlugs?.length ||
      prefs.cities?.length ||
      prefs.jobTypes?.length ||
      prefs.titles?.length ||
      prefs.remoteOnly,
  );
  if (!hasTargeting) return report;

  const unlimitedApply = prefs.unlimitedApply === true;
  const userDailyLimit =
    typeof prefs.dailyLimit === "number" && prefs.dailyLimit > 0
      ? Math.floor(prefs.dailyLimit)
      : dailyCap;
  const effectiveDailyCap = unlimitedApply ? Number.POSITIVE_INFINITY : Math.min(dailyCap, userDailyLimit);

  // سقفِ روزانه/هفتگی: ظرفیتِ باقی‌مانده (همان شمارشِ tasks این کاربر — فیلتر + AI).
  let remainingCap = unlimitedApply
    ? Number.POSITIVE_INFINITY
    : Math.max(0, effectiveDailyCap - (await countQueuedToday(conn, userId)));
  if (!unlimitedApply && typeof prefs.weeklyLimit === "number" && prefs.weeklyLimit > 0) {
    remainingCap = Math.min(
      remainingCap,
      Math.max(0, Math.floor(prefs.weeklyLimit) - (await countQueuedThisWeek(conn, userId))),
    );
  }

  // امضای فیلتر برای مکان‌نما — با تغییرِ فیلترها عوض می‌شود و پیمایش از صفحه‌ی ۱ آغاز می‌شود.
  const filterSig = computeFilterSignature(prefs);

  boardsLoop: for (const boardId of boards) {
    // گِیتِ سایت: فقط سایت‌های زنده (jobinja). داربست‌ها را رد کن تا اپلایِ توخالی نسازند.
    if (!isBoardLive(boardId)) {
      report.errors.push(`سایت ${boardId} هنوز پشتیبانی نمی‌شود (به‌زودی)`);
      continue;
    }
    const connector = resolveConnector(boardId);
    if (!connector) {
      report.errors.push(`کانکتور برای سایت ${boardId} ثبت نشده است`);
      continue;
    }
    // بودجه‌ی روزانه تمام شد → نه برداشت کن، نه مکان‌نما را جلو ببر (اجرای بعد همین صفحات را می‌گیرد).
    if (remainingCap <= 0) break boardsLoop;

    // مکان‌نما: از کجای نتایج ادامه دهیم؟ کاربران unlimited به‌جای سقفِ صفحه/تعداد، تا مرزِ
    // تازگیِ آگهی (۴۵ روز) جلو می‌روند؛ کاربران عادی با سقف‌های سابق محافظت می‌شوند.
    const startPage = await readCursorFn(conn, userId, boardId, filterSig);
    const targetCount = unlimitedApply
      ? undefined
      : Math.max(1, Math.min(perRunListingCap, remainingCap));

    // ۱) ingestِ عمومیِ فیلترشده (فقط-خواندنی)، از startPage با پنجره‌ی صفحه.
    //    مهم: در مسیرِ صفحه‌بندی *همه‌ی* آگهی‌های واکشی‌شده پردازش می‌شوند (بدونِ slice)، تا
    //    «صفحه‌های واکشی‌شده» دقیقاً با «صفحه‌های پردازش‌شده» یکی باشد و مکان‌نما هیچ آگهیِ
    //    واکشی‌شده‌ای را جا نیندازد. سقفِ اجرا (perRunListingCap) از راهِ targetCount محدود
    //    می‌کند «چقدر» واکشی شود (نه اینکه بعداً دور ریخته شود). فقط مسیرِ بدونِ صفحه‌بندی
    //    (fallback) برای ایمنی slice می‌شود.
    let listings: JobListing[];
    let pagesFetched = 1;
    let reachedEnd = true; // پیش‌فرضِ محافظه‌کار برای کانکتورهای بدونِ صفحه‌بندی.
    try {
      if (supportsPagedScrape(connector)) {
        const res = await connector.scrapePublicWith(prefs, {
          startPage,
          maxPages: unlimitedApply ? Number.POSITIVE_INFINITY : FILTER_SCRAPE_MAX_PAGES,
          ...(targetCount === undefined ? {} : { targetCount }),
          ...(unlimitedApply ? { stopWhenStaleDays: MAX_JOB_POSTED_AGE_DAYS } : {}),
        });
        listings = res.listings;
        pagesFetched = res.pagesFetched;
        reachedEnd = res.reachedEnd;
      } else {
        listings = (await connector.scrapePublic(prefs)).slice(0, Math.max(0, perRunListingCap));
      }
    } catch (err) {
      report.errors.push(`scrapePublic(${boardId}): ${errMsg(err)}`);
      continue;
    }
    report.ingested += listings.length;

    // آیا این اجرا نیمه‌کاره ماند (سقفِ روزانه/موجودی، یا خطای زیرساختِ نوشتن)؟ اگر بله،
    // مکان‌نما را جلو نمی‌بریم تا آگهی‌های صف‌نشده‌ی همین صفحات در اجرای بعد از دست نروند.
    let cutShort = false;

    for (let i = 0; i < listings.length; i += 1) {
      const job = await freshJobForProcessing(listings[i]!);
      if (!job) continue;
      if (!matchesCandidateGender(job, prefs)) continue;

      // ۰) گیتِ بودجه *پیش از هر کاری* (به‌ویژه پیش از امتیازدهیِ مترشده): وقتی سقفِ روزانه
      //    پر شد، هیچ آگهیِ تازه‌ای صف نمی‌شود؛ پس ادامه‌ی امتیازدهی صرفاً کیف‌پول را بی‌فایده
      //    شارژ می‌کند. می‌ایستیم، بقیه را «ردشده به‌خاطرِ سقف» می‌شماریم و مکان‌نما را نگه می‌داریم.
      if (remainingCap <= 0) {
        report.skippedByCap += listings.length - i;
        cutShort = true;
        break;
      }

      // ۲) پایدارسازیِ آگهی.
      let listingRow: JobListingRow;
      try {
        listingRow = await persistListingWith(conn, job);
        report.persistedListings += 1;
      } catch (err) {
        report.errors.push(`persistListing(${job.id}): ${errMsg(err)}`);
        continue;
      }

      // ۲.۵) خواندنِ تطبیقِ موجود *پیش از هزینه*. دو نقشِ حیاتیِ ضدِ دوباره‌شارژ:
      //   • 'queued'/'dismissed' به سرانجام رسیده → کلاً رد کن.
      //   • هر تطبیقِ *از قبل امتیازخورده* (score غیرِ null، یعنی 'drafted'/'scored') → امتیازش
      //     را **بازاستفاده** کن و scoreFnِ مترشده را دوباره صدا نزن. بدونِ این، اسکنِ دوباره‌ی
      //     همان صفحات (بازنشانی مکان‌نما، تلاشِ دوباره پس از خطای enqueue، یا همپوشانیِ اجراها)
      //     آگهیِ زیرِ-آستانه یا drafted-نشده‌ی-قبلی را دوباره امتیاز و شارژ می‌کرد. قاعده: هر
      //     (کاربر×آگهی) حداکثر یک‌بار امتیاز می‌خورد؛ اجراهای بعد از امتیازِ ذخیره‌شده استفاده می‌کنند.
      let prior:
        | { status: string; score: number | null; reason: string | null; coverLetter: string | null }
        | undefined;
      try {
        prior = await conn.query.matches.findFirst({
          columns: { status: true, score: true, reason: true, coverLetter: true },
          where: and(eq(matches.userId, userId), eq(matches.listingId, listingRow.id)),
        });
      } catch (err) {
        // خواندنِ وضعیتِ تطبیق شکست خورد (زیرساخت) — امن‌ترین کار: این آگهی را رد کن و
        // مکان‌نما را نگه‌دار تا اجرای بعد دوباره تلاش کند (نه امتیازدهیِ کورکورانه).
        report.errors.push(`priorMatch(${job.id}): ${errMsg(err)}`);
        cutShort = true;
        continue;
      }
      if (prior?.status === "dismissed") {
        report.skippedDismissed += 1;
        continue;
      }
      if (prior?.status === "queued") {
        report.alreadyQueued += 1;
        continue;
      }

      // ۳) (فقط aiFilter) امتیازدهی. زیرِ آستانه → 'scored'، صف نمی‌شود.
      let matchScore: number | null = null;
      let coverLetter: string | null = null;
      let reason: string | null = null;
      let aboveThreshold = true;
      if (aiFilter) {
        if (prior && prior.score !== null && prior.score !== undefined) {
          // قبلاً امتیاز خورده → بازاستفاده، بدونِ فراخوانیِ مترشده (بدونِ شارژِ دوباره).
          matchScore = prior.score;
          reason = prior.reason ?? null;
          coverLetter = prior.coverLetter ?? null;
          aboveThreshold = prior.score >= threshold;
        } else {
          try {
            const s = await scoreFn(job, profile);
            report.scored += 1;
            matchScore = s.matchScore;
            reason = s.reason ?? null;
            coverLetter = job.board === "jobinja" ? null : s.coverLetter;
            aboveThreshold = s.matchScore >= threshold;
          } catch (err) {
            // اتمامِ موجودی → کلِ اجرا را متوقف کن (break از حلقه‌ی برچسب‌دارِ سایت‌ها)، تا
            // آگهی‌های بعدی فراخوانیِ گیت‌ویِ بی‌محاسبه نسازند. نتیجه‌ی جزئی برمی‌گردد.
            if (isInsufficientBalance(err)) {
              report.errors.push("اجرا به‌خاطرِ اتمامِ موجودیِ هوش مصنوعی متوقف شد");
              cutShort = true; // نیمه‌کاره → مکان‌نما جلو نمی‌رود.
              break boardsLoop;
            }
            report.errors.push(`score(${job.id}): ${errMsg(err)}`);
            continue;
          }
        }
      }

      // ۴) upsertِ تطبیق (یکتا روی user×listing). 'queued'/'dismissed'ِ قبلی حفظ می‌شود.
      //    فیلترمود: امتیاز/انگیزه‌نامه‌ی موجود (احتمالاً از مسیرِ AI) را پاک نمی‌کند.
      const insertStatus: "scored" | "drafted" =
        aiFilter && aboveThreshold ? "drafted" : "scored";
      let matchId = "";
      let matchStatus = "";
      let upsertOk = false;
      let upsertErr: unknown;
      // تلاشِ دوباره: امتیازِ AI پیش از این *به 1xai پرداخت شده*؛ اگر نوشتنِ تطبیقِ محلی به
      // خطای گذرا بخورد و امتیاز ذخیره نشود، اجرای بعد (چون prior.score هنوز null است) دوباره
      // شارژ می‌کرد. چند تلاش، پنجره‌ی این دوباره‌شارژ را تقریباً صفر می‌کند.
      for (let attempt = 1; attempt <= MATCH_UPSERT_ATTEMPTS; attempt += 1) {
        try {
          const [matchRow] = await conn
            .insert(matches)
            .values({
              userId,
              listingId: listingRow.id,
              score: matchScore,
              status: insertStatus,
              // متنِ خروجیِ AI پاک‌سازی می‌شود (NUL/C0) تا یک آگهیِ مسموم درجِ تطبیق را قطعی
              // نشکند و حلقه‌ی شارژِ دوباره نسازد.
              reason: aiFilter ? sanitizePgText(reason) : null,
              // انگیزه‌نامه‌ی *پرداخت‌شده* را صرف‌نظر از آستانه ذخیره کن؛ اگر بعداً آستانه پایین
              // بیاید و امتیاز بازاستفاده شود، این آرتیفکت بدونِ شارژِ دوباره در دسترس است.
              coverLetter: aiFilter && job.board !== "jobinja" ? sanitizePgText(coverLetter) : null,
              scoredAt: aiFilter ? sql`now()` : null,
            })
            .onConflictDoUpdate({
              target: [matches.userId, matches.listingId],
              set: aiFilter
                ? {
                    score: sql`excluded.score`,
                    reason: sql`excluded.reason`,
                    coverLetter: sql`excluded.cover_letter`,
                    status: sql`CASE WHEN ${matches.status} IN ('queued','dismissed')
                                     THEN ${matches.status}
                                     ELSE excluded.status END`,
                    scoredAt: sql`now()`,
                    updatedAt: sql`now()`,
                  }
                : {
                    // فیلترمود: امتیاز/انگیزه‌نامه/زمانِ امتیاز را دست نمی‌زنیم (حفظ).
                    reason: sql`${matches.reason}`,
                    status: sql`CASE WHEN ${matches.status} IN ('queued','dismissed')
                                     THEN ${matches.status}
                                     ELSE 'scored'::match_status END`,
                    updatedAt: sql`now()`,
                  },
            })
            .returning({ id: matches.id, status: matches.status });
          matchId = matchRow.id;
          matchStatus = matchRow.status;
          upsertOk = true;
          break;
        } catch (err) {
          upsertErr = err;
          if (attempt < MATCH_UPSERT_ATTEMPTS) await sleepMs(MATCH_UPSERT_RETRY_MS * attempt);
        }
      }
      if (!upsertOk) {
        // خطای پایدارِ نوشتن — آگهیِ صف‌نشده باقی ماند؛ مکان‌نما را نگه‌دار تا اجرای بعد دوباره
        // تلاش کند (این خطاها همه‌یا-هیچ‌اند، نه مسمومِ تک‌آگهی، پس گیر نمی‌اندازد).
        report.errors.push(`persistMatch(${job.id}): ${errMsg(upsertErr)}`);
        cutShort = true;
        continue;
      }

      // ۵) aiFilter زیرِ آستانه → صف نمی‌شود (scored).
      if (aiFilter && !aboveThreshold) {
        report.belowThreshold += 1;
        continue;
      }

      // dedupe: قبلاً ردشده یا از قبل در صف → دوباره صف نکن.
      if (matchStatus === "dismissed") {
        report.skippedDismissed += 1;
        continue;
      }
      if (matchStatus === "queued") {
        report.alreadyQueued += 1;
        continue;
      }

      // سقفِ روزانه پیشاپیش در گیتِ بالای حلقه بررسی شد (پیش از امتیازدهی)؛ اینجا remainingCap>0 است.

      // ۶) ورود به صف (idempotent). mode برچسب می‌خورد تا claim فیلتر/AI را تفکیک کند.
      try {
        const { created } = await enqueueFn(
          {
            idempotencyKey: `apply:${matchId}`,
            matchId,
            payload: {
              board: job.board,
              listingId: listingRow.id,
              url: job.url,
              mode: aiFilter ? "ai" : "filter",
              ...(matchScore !== null ? { matchScore } : {}),
              ...(coverLetter && job.board !== "jobinja" ? { coverLetter } : {}),
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
        } else {
          report.alreadyQueued += 1;
        }
      } catch (err) {
        // خطای نوشتنِ صف (DB) — این آگهی صف نشد؛ مکان‌نما را نگه‌دار تا اجرای بعد دوباره
        // تلاش کند. idempotencyKey از صف‌شدنِ دوباره‌ی همان تطبیق جلوگیری می‌کند.
        report.errors.push(`enqueue(apply:${matchId}): ${errMsg(err)}`);
        cutShort = true;
        continue;
      }
    }

    // مکان‌نما را فقط وقتی جلو ببر که این اجرا کامل مصرف شد (نه نیمه‌کاره به‌خاطرِ سقفِ روزانه/
    // موجودی/خطای زیرساخت). رسیدن به انتها → بازنشانی به ۱ تا اجرای بعد سرِ فهرست را دوباره اسکن کند.
    report.reachedEnd = reachedEnd;
    if (!cutShort) {
      const nextPage = reachedEnd ? 1 : startPage + Math.max(1, pagesFetched);
      try {
        await advanceCursorFn(conn, userId, boardId, filterSig, nextPage);
      } catch (err) {
        report.errors.push(`advanceCursor(${boardId}): ${errMsg(err)}`);
      }
    }
  }

  return report;
}

/** Result of importing listings discovered through the user's local browser session. */
export interface BrowserDiscoveryReport {
  ingested: number;
  queued: number;
  alreadyQueued: number;
  stale: number;
  genderFiltered: number;
  errors: string[];
}

/**
 * Persist and enqueue Jobinja listings that the extension read from the user's
 * authenticated search page. This is the free path: no AI score, cover letter,
 * tailored resume, daily cap, or server-side board request.
 */
export async function enqueueBrowserDiscoveredListings(
  userId: string,
  listings: JobListing[],
  conn: OrchestratorDb = db,
): Promise<BrowserDiscoveryReport> {
  const loaded = await defaultLoadFilterProfile(userId, conn);
  if (!loaded) throw new HttpError(404, "profile not found");

  const report: BrowserDiscoveryReport = {
    ingested: listings.length,
    queued: 0,
    alreadyQueued: 0,
    stale: 0,
    genderFiltered: 0,
    errors: [],
  };

  const ordered = [...listings].sort((a, b) => {
    const aTime = toPostedDate(a.postedAt)?.getTime() ?? 0;
    const bTime = toPostedDate(b.postedAt)?.getTime() ?? 0;
    return bTime - aTime;
  });

  for (const job of ordered) {
    if (!isFreshJobPosting(job)) {
      report.stale += 1;
      continue;
    }
    if (!matchesCandidateGender(job, loaded.prefs)) {
      report.genderFiltered += 1;
      continue;
    }

    try {
      const listingRow = await persistListingWith(conn, job);
      const prior = await conn.query.matches.findFirst({
        columns: { id: true, status: true },
        where: and(eq(matches.userId, userId), eq(matches.listingId, listingRow.id)),
      });
      if (prior?.status === "queued" || prior?.status === "dismissed") {
        report.alreadyQueued += prior.status === "queued" ? 1 : 0;
        continue;
      }

      const [matchRow] = await conn
        .insert(matches)
        .values({
          userId,
          listingId: listingRow.id,
          score: null,
          status: "scored",
          reason: null,
          coverLetter: null,
          scoredAt: null,
        })
        .onConflictDoUpdate({
          target: [matches.userId, matches.listingId],
          set: {
            status: sql`CASE WHEN ${matches.status} IN ('queued','dismissed')
                             THEN ${matches.status}
                             ELSE 'scored'::match_status END`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: matches.id, status: matches.status });

      if (matchRow.status === "queued" || matchRow.status === "dismissed") {
        report.alreadyQueued += matchRow.status === "queued" ? 1 : 0;
        continue;
      }

      const { created } = await defaultEnqueue(
        {
          idempotencyKey: `apply:${matchRow.id}`,
          matchId: matchRow.id,
          payload: {
            board: job.board,
            listingId: listingRow.id,
            url: job.url,
            mode: "filter",
            discovery: "extension",
          },
        },
        conn as unknown as Parameters<EnqueueFn>[1],
      );
      await conn
        .update(matches)
        .set({ status: "queued", updatedAt: sql`now()` })
        .where(eq(matches.id, matchRow.id));
      if (created) report.queued += 1;
      else report.alreadyQueued += 1;
    } catch (error) {
      report.errors.push(`${job.id}: ${errMsg(error)}`);
    }
  }

  return report;
}
