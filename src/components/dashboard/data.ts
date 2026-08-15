import "server-only";

/**
 * خواندنِ داده‌ی داشبورد مستقیم از DB (server-side) — طبق الگوی RSC: بدونِ round-trip
 * به API. همه فقط-خواندنی‌اند و به userId محدود می‌شوند (قاعده‌ی ۴: داده‌ی هر کاربر
 * فقط برای همان کاربر). هیچ ستونِ حساسی (نشست/کلید) خوانده نمی‌شود.
 *
 * هر تابع با `cache` پوشانده شده تا در یک رندر، چند کامپوننت بدونِ کوئریِ تکراری
 * از آن استفاده کنند. خطاها به فراخواننده می‌رسند (صفحه می‌تواند Suspense/empty کند).
 */
import { cache } from "react";
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  applications,
  boardAccounts,
  boardApplications,
  candidateProfiles,
  jobListings,
  matches,
  tasks,
} from "@/db/schema";

/** یک ردیفِ تطبیق همراهِ اطلاعاتِ آگهی — هم‌ساختار با خروجیِ GET /api/matches. */
export interface DashboardMatch {
  id: string;
  listingId: string;
  score: number | null;
  status: "pending" | "scored" | "drafted" | "queued" | "dismissed";
  reason: string | null;
  coverLetter: string | null;
  scoredAt: Date | null;
  createdAt: Date;
  listing: {
    board: string;
    title: string;
    company: string | null;
    city: string | null;
    url: string;
    salary: string | null;
    postedAt: Date | null;
  };
}

/** فهرستِ تطبیق‌های کاربر (بالاترین امتیاز اول). */
export const getMatchesForUser = cache(
  async (userId: string, limit = 30): Promise<DashboardMatch[]> => {
    const listingJobKey = sql`regexp_replace(${jobListings.url}, '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`;
    const boardApplicationJobKey = sql`regexp_replace(coalesce(ba.url, ''), '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`;
    const rows = await db
      .select({
        id: matches.id,
        listingId: matches.listingId,
        score: matches.score,
        status: matches.status,
        reason: matches.reason,
        coverLetter: matches.coverLetter,
        scoredAt: matches.scoredAt,
        createdAt: matches.createdAt,
        listing: {
          board: jobListings.board,
          title: jobListings.title,
          company: jobListings.company,
          city: jobListings.city,
          url: jobListings.url,
          salary: jobListings.salary,
          postedAt: jobListings.postedAt,
        },
      })
      .from(matches)
      .innerJoin(jobListings, eq(matches.listingId, jobListings.id))
      .where(sql`
        ${matches.userId} = ${userId}
        and ${jobListings.postedAt} >= now() - interval '45 days'
        and not exists (
          select 1
          from ${applications} a
          where a.user_id = ${userId}
            and a.listing_id = ${jobListings.id}
            and a.status = 'submitted'
        )
        and not exists (
          select 1
          from ${boardApplications} ba
          where ba.user_id = ${userId}
            and ba.board = ${jobListings.board}::text
            and ${boardApplicationJobKey} = ${listingJobKey}
        )
      `)
      .orderBy(desc(matches.score), desc(matches.createdAt))
      .limit(limit);

    return rows as DashboardMatch[];
  },
);

/** یک ردیفِ اپلای همراهِ عنوان/شرکتِ آگهی — برای فهرستِ پیگیری. */
export interface DashboardApplication {
  id: string;
  status: "draft" | "submitted" | "skipped" | "failed";
  channel: "extension" | "worker" | null;
  matchScore: number | null;
  externalRef: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  listing: {
    board: string;
    title: string;
    company: string | null;
    url: string;
  };
}

/** فهرستِ اپلای‌های کاربر (تازه‌ترین اول). در فاز فعلی معمولاً خالی است. */
export const getApplicationsForUser = cache(
  async (userId: string, limit = 50): Promise<DashboardApplication[]> => {
    const rows = await db
      .select({
        id: applications.id,
        status: applications.status,
        channel: applications.channel,
        matchScore: applications.matchScore,
        externalRef: applications.externalRef,
        submittedAt: applications.submittedAt,
        createdAt: applications.createdAt,
        listing: {
          board: jobListings.board,
          title: jobListings.title,
          company: jobListings.company,
          url: jobListings.url,
        },
      })
      .from(applications)
      .innerJoin(jobListings, eq(applications.listingId, jobListings.id))
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.createdAt))
      .limit(limit);

    return rows as DashboardApplication[];
  },
);

/** نمای کوتاهِ پروفایلِ کاربر (نام/تخصص) — برای خوشامدِ داشبورد. */
export interface DashboardProfile {
  fullName: string;
  headline: string | null;
  city: string | null;
}

export const getProfileForUser = cache(
  async (userId: string): Promise<DashboardProfile | null> => {
    const [row] = await db
      .select({
        fullName: candidateProfiles.fullName,
        headline: candidateProfiles.headline,
        city: candidateProfiles.city,
      })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1);

    return row ?? null;
  },
);

/** حسابِ متصلِ کاربر روی یک سایت کاریابی (فقط متادیتا — هیچ رازی). */
export interface DashboardBoardAccount {
  board: string;
  status: "connected" | "expired" | "needs_reauth";
  accountLabel: string | null;
  lastConnectedAt: Date | null;
}

export const getBoardAccountsForUser = cache(
  async (userId: string): Promise<DashboardBoardAccount[]> => {
    const rows = await db
      .select({
        board: boardAccounts.board,
        status: boardAccounts.status,
        accountLabel: boardAccounts.accountLabel,
        lastConnectedAt: boardAccounts.lastConnectedAt,
      })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId))
      .orderBy(desc(boardAccounts.lastConnectedAt));

    return rows;
  },
);

/** خلاصه‌ی شمارشِ داشبورد — صف، امروز، کل، و ۳۰ روز اخیر. */
export interface DashboardCounts {
  queued: number;
  appliedToday: number;
  appliedTotal: number;
  appliedLast30d: number;
}

export const getDashboardCounts = cache(
  async (userId: string): Promise<DashboardCounts> => {
    const [queueRows, todayRows, totalRows, last30Rows] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .innerJoin(matches, eq(tasks.matchId, matches.id))
        .where(
          sql`${matches.userId} = ${userId}
              and ${tasks.status} in ('pending', 'leased')`,
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(
          sql`${applications.userId} = ${userId}
              and ${applications.status} = 'submitted'
              and coalesce(${applications.submittedAt}, ${applications.createdAt}) >= date_trunc('day', now())`,
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(sql`${applications.userId} = ${userId} and ${applications.status} = 'submitted'`),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(
          sql`${applications.userId} = ${userId}
              and ${applications.status} = 'submitted'
              and coalesce(${applications.submittedAt}, ${applications.createdAt}) >= now() - interval '30 days'`,
        ),
    ]);

    return {
      queued: queueRows[0]?.n ?? 0,
      appliedToday: todayRows[0]?.n ?? 0,
      appliedTotal: totalRows[0]?.n ?? 0,
      appliedLast30d: last30Rows[0]?.n ?? 0,
    };
  },
);
