"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { boardAccounts, jobListings, matches } from "@/db/schema";
import { getDashboardUser } from "@/components/dashboard/session";
import { isBoardLive } from "@/lib/apply/registry";
import { isFreshProviderDate } from "@/lib/apply/freshness";
import { enqueue } from "@/lib/queue";

const JOB_KEY_LISTING = sql.raw(
  `regexp_replace(l.url, '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);
const JOB_KEY_PROVIDER = sql.raw(
  `regexp_replace(coalesce(ba.url, ''), '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`,
);

function safeReturnTo(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/dashboard/jobs")) {
    return "/dashboard/jobs";
  }
  return value.slice(0, 500);
}

function withResult(returnTo: string, result: string): string {
  const url = new URL(returnTo, "https://karjoo.local");
  url.searchParams.set("result", result);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export async function queueJobApplyAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const listingId = formData.get("listingId");
  if (typeof listingId !== "string" || listingId.length < 8) {
    redirect(withResult(returnTo, "invalid"));
  }

  const [listing] = await db
    .select({
      id: jobListings.id,
      board: jobListings.board,
      url: jobListings.url,
      postedAt: jobListings.postedAt,
    })
    .from(jobListings)
    .where(eq(jobListings.id, listingId))
    .limit(1);

  if (!listing) redirect(withResult(returnTo, "missing"));
  if (!isBoardLive(listing.board)) redirect(withResult(returnTo, "provider"));
  if (!isFreshProviderDate(listing.postedAt)) redirect(withResult(returnTo, "stale"));

  const [account] = await db
    .select({ id: boardAccounts.id, status: boardAccounts.status })
    .from(boardAccounts)
    .where(and(eq(boardAccounts.userId, user.userId), eq(boardAccounts.board, listing.board)))
    .limit(1);
  if (!account || account.status !== "connected") {
    redirect(withResult(returnTo, "connect"));
  }

  const [duplicate] = (await db.execute<{ id: string }>(sql`
    select evidence.id
    from (
      select a.id
      from applications a
      where a.user_id = ${user.userId}
        and a.listing_id = ${listing.id}
        and a.status in ('draft', 'submitted')
      union all
      select ba.id
      from board_applications ba
      join job_listings l on l.id = ${listing.id}
      where ba.user_id = ${user.userId}
        and ba.board = ${listing.board}::text
        and (ba.url = l.url or ${JOB_KEY_PROVIDER} = ${JOB_KEY_LISTING})
    ) evidence
    limit 1
  `)) as unknown as { id: string }[];
  if (duplicate) redirect(withResult(returnTo, "duplicate"));

  const [matchRow] = await db
    .insert(matches)
    .values({
      userId: user.userId,
      listingId: listing.id,
      score: null,
      status: "scored",
      reason: "درخواست مستقیم از صفحه‌ی فرصت‌های شغلی",
      coverLetter: null,
      scoredAt: null,
    })
    .onConflictDoUpdate({
      target: [matches.userId, matches.listingId],
      set: {
        status: sql`CASE WHEN ${matches.status} = 'dismissed'
                         THEN ${matches.status}
                         ELSE 'scored'::match_status END`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: matches.id, status: matches.status });

  if (matchRow.status === "dismissed") redirect(withResult(returnTo, "dismissed"));

  const { created } = await enqueue({
    idempotencyKey: `apply:${matchRow.id}`,
    matchId: matchRow.id,
    sessionRef: account.id,
    payload: {
      board: listing.board,
      listingId: listing.id,
      url: listing.url,
      mode: "manual",
      discovery: "dashboard_jobs",
    },
  });

  await db
    .update(matches)
    .set({ status: "queued", updatedAt: sql`now()` })
    .where(and(eq(matches.id, matchRow.id), eq(matches.userId, user.userId)));

  redirect(withResult(returnTo, created ? "queued" : "already_queued"));
}
