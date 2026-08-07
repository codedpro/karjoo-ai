import "server-only";

/**
 * بایگانیِ اپلای — «چه چیزی، برای چه کسی، با کدام رزومه فرستاده شد».
 *
 * وقتی کارفرما تماس می‌گیرد، کاربر باید بتواند دقیقاً همان چیزی را ببیند که برایش رفته:
 * شرکت، شرحِ شغل (JD)، تاریخ، و **همان نسخه‌ی رزومه‌ای که ارسال شده** — نه رزومه‌ی پایه
 * و نه نسخه‌ی امروز. چون رزومه‌ی سفارشیِ هر آگهی در `resumes` (isBase=false, listingId)
 * ذخیره می‌شود و اکنون `applications.resume_id` به آن پیوند می‌خورد، بایگانی دقیق است.
 *
 * همه‌ی کوئری‌ها مقید به `userId` نشست‌اند (قاعده‌ی ۴) — هرگز cross-user.
 */
import { and, desc, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { applications, jobListings, resumes } from "@/db/schema";

export type ArchiveDb = typeof defaultDb;

/** یک ردیفِ بایگانی — همه‌چیزِ لازم برای جدول + مودالِ JD. */
export interface ArchivedApplication {
  id: string;
  status: string;
  channel: string | null;
  matchScore: number | null;
  reason: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  listing: {
    title: string;
    company: string | null;
    city: string | null;
    url: string;
    board: string;
    /** شرحِ کاملِ آگهی — در مودال نمایش داده می‌شود. */
    description: string | null;
  };
  /** رزومه‌ی واقعاً ارسال‌شده (اگر سفارشی ساخته شده بود). */
  resume: { id: string; title: string | null } | null;
}

/** بایگانیِ اپلایِ کاربر، تازه‌ترین اول. */
export async function listApplicationArchive(
  userId: string,
  limit = 100,
  conn: ArchiveDb = defaultDb,
): Promise<ArchivedApplication[]> {
  const rows = await conn
    .select({
      id: applications.id,
      status: applications.status,
      channel: applications.channel,
      matchScore: applications.matchScore,
      reason: applications.reason,
      submittedAt: applications.submittedAt,
      createdAt: applications.createdAt,
      title: jobListings.title,
      company: jobListings.company,
      city: jobListings.city,
      url: jobListings.url,
      board: jobListings.board,
      description: jobListings.description,
      resumeId: resumes.id,
      resumeTitle: resumes.title,
    })
    .from(applications)
    .innerJoin(jobListings, eq(applications.listingId, jobListings.id))
    .leftJoin(resumes, eq(applications.resumeId, resumes.id))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.createdAt))
    .limit(Math.max(1, Math.min(limit, 500)));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    channel: r.channel,
    matchScore: r.matchScore,
    reason: r.reason,
    submittedAt: r.submittedAt,
    createdAt: r.createdAt,
    listing: {
      title: r.title,
      company: r.company,
      city: r.city,
      url: r.url,
      board: r.board,
      description: r.description,
    },
    resume: r.resumeId ? { id: r.resumeId, title: r.resumeTitle } : null,
  }));
}

/**
 * HTMLِ همان رزومه‌ای که با این اپلای رفته است — مقید به کاربر.
 *
 * از `applications.resume_id` می‌خواند (نه از «آخرین رزومه»)، پس حتی اگر کاربر بعداً
 * رزومه‌ی پایه‌اش را عوض کند، این‌جا همان نسخه‌ی ارسال‌شده برمی‌گردد.
 * `null` یعنی این اپلای رزومه‌ی سفارشی نداشته (با رزومه‌ی پروفایلِ خودِ بورد رفته).
 */
export async function getSentResumeHtml(
  userId: string,
  applicationId: string,
  conn: ArchiveDb = defaultDb,
): Promise<{ html: string; title: string | null; company: string | null } | null> {
  const [row] = await conn
    .select({
      html: resumes.content,
      title: resumes.title,
      company: jobListings.company,
    })
    .from(applications)
    .innerJoin(resumes, eq(applications.resumeId, resumes.id))
    .innerJoin(jobListings, eq(applications.listingId, jobListings.id))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);

  return row ?? null;
}
