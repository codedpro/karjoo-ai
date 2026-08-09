import "server-only";

/**
 * پرس‌وجوی صفحه‌ی «اپلای‌ها» — فیلتر، مرتب‌سازی و صفحه‌بندیِ **سمتِ پایگاه‌داده**.
 *
 * چرا جدا از `getApplications`: آن تابع همه‌ی ردیف‌ها را با سقفِ ۵۰۰ می‌خواند و قیف را از
 * روی همان‌ها می‌شمارد. با ۴۶۴ درخواست هنوز کار می‌کرد، ولی سه اشکالِ واقعی داشت:
 *   • قیف با عبور از سقف بی‌سر و صدا غلط می‌شد (شمارش از نمونه، نه از کل).
 *   • مرتب‌سازی روی `last_seen_at` بود — یعنی زمانِ *همگام‌سازی*، نه زمانِ *ارسال*.
 *   • فیلتر و صفحه‌بندی اصلاً وجود نداشت و کلِ فهرست یک‌جا رندر می‌شد.
 *
 * این‌جا شمارشِ قیف با GROUP BY روی کلِ ردیف‌ها انجام می‌شود (بدونِ سقف)، و فهرست با
 * LIMIT/OFFSET برمی‌گردد. تاریخِ انتشارِ آگهی با LEFT JOIN روی **کلیدِ کوتاه‌شده‌ی آگهی**
 * می‌آید (نه روی URLِ کامل) — برای درخواست‌هایی که آگهی‌شان را ندیده‌ایم NULL می‌ماند و در
 * مرتب‌سازی به ته می‌رود.
 *
 * مقید به کاربر: همه‌ی پرس‌وجوها `user_id` را شرط دارند.
 */
import { sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import type { BoardApplication } from "@/db/schema";
import type { ApplicationFunnel, ApplicationStatusCategory } from "@/lib/apply/boards/jobinja-read";

/** ستون‌هایی که می‌شود روی‌شان مرتب کرد. */
export const APPLICATION_SORTS = ["applied", "posted", "status", "company"] as const;
export type ApplicationSort = (typeof APPLICATION_SORTS)[number];

export const APPLICATION_STATUSES: ApplicationStatusCategory[] = [
  "pending",
  "review",
  "interview",
  "hired",
  "rejected",
  "other",
];

export const DEFAULT_PAGE_SIZE = 25;
/** سقفِ اندازه‌ی صفحه — جلوگیری از کشیدنِ کلِ جدول با یک پارامترِ URL. */
export const MAX_PAGE_SIZE = 100;

export interface ApplicationQuery {
  status?: ApplicationStatusCategory | null;
  /** جست‌وجوی متنی روی عنوان و نامِ شرکت. */
  q?: string | null;
  sort?: ApplicationSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/** یک ردیفِ درخواست + تاریخِ انتشارِ آگهی (اگر آگهی را می‌شناسیم). */
export type ApplicationRow = BoardApplication & { postedAt: Date | null };

export interface ApplicationPage {
  items: ApplicationRow[];
  funnel: ApplicationFunnel;
  /** تعدادِ کلِ ردیف‌های **پس از فیلتر** (پایه‌ی صفحه‌بندی). */
  filteredTotal: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** پارامترهای خام URL را به پرس‌وجوی معتبر تبدیل می‌کند (ورودیِ نامعتبر → پیش‌فرض). */
export function parseApplicationQuery(params: Record<string, string | undefined>): Required<
  Omit<ApplicationQuery, "status" | "q">
> & { status: ApplicationStatusCategory | null; q: string | null } {
  const status = APPLICATION_STATUSES.includes(params.status as ApplicationStatusCategory)
    ? (params.status as ApplicationStatusCategory)
    : null;
  const sort = (APPLICATION_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as ApplicationSort)
    : "applied";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const rawSize = Number.parseInt(params.pageSize ?? "", 10);
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(5, rawSize))
    : DEFAULT_PAGE_SIZE;
  const q = params.q?.trim() ? params.q.trim().slice(0, 80) : null;
  return { status, q, sort, dir, page, pageSize };
}

/**
 * کلیدِ پایدارِ یک آگهیِ جابینجا از دلِ URL: `/companies/{شرکت}/jobs/{شناسه}`.
 *
 * چرا لازم است: صفحه‌ی «درخواست‌های من» لینکِ **کوتاه** می‌دهد
 * (`…/companies/gaply/jobs/t404`) ولی نتایجِ جست‌وجو لینکِ **بلند** با اسلاگِ عنوان
 * (`…/jobs/t404/استخدام-توسعه-دهنده-…`). تطبیقِ برابریِ ساده هیچ‌وقت جواب نمی‌داد و
 * تاریخِ انتشارِ آگهی همیشه NULL می‌شد.
 */
const jobKey = (col: string) =>
  sql.raw(`regexp_replace(${col}, '^(https?://[^/]+/companies/[^/]+/jobs/[^/?#]+).*$', '\\1')`);
const JOB_KEY_A = jobKey("a.url");
const JOB_KEY_L = jobKey("l.url");

const EMPTY_FUNNEL: ApplicationFunnel = {
  total: 0,
  pending: 0,
  review: 0,
  interview: 0,
  hired: 0,
  rejected: 0,
  other: 0,
};

export async function listApplicationsPage(
  userId: string,
  board: string,
  query: ApplicationQuery = {},
  deps: { db?: Database } = {},
): Promise<ApplicationPage> {
  const conn = deps.db ?? defaultDb;
  const { status, q, sort, dir, page, pageSize } = parseApplicationQuery({
    status: query.status ?? undefined,
    q: query.q ?? undefined,
    sort: query.sort,
    dir: query.dir,
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? DEFAULT_PAGE_SIZE),
  });

  // قیف همیشه از **کلِ** درخواست‌های کاربر شمرده می‌شود، نه از صفحه‌ی جاری یا فیلترِ فعال —
  // وگرنه انتخابِ یک فیلتر، آمارِ بالای صفحه را هم عوض می‌کرد و مقایسه بی‌معنا می‌شد.
  const counts = await conn.execute<{ status_category: ApplicationStatusCategory; n: number }>(sql`
    select status_category, count(*)::int as n
    from board_applications
    where user_id = ${userId} and board = ${board}
    group by status_category
  `);
  const funnel: ApplicationFunnel = { ...EMPTY_FUNNEL };
  for (const row of counts as unknown as { status_category: string; n: number }[]) {
    if (row.status_category in funnel && row.status_category !== "total") {
      funnel[row.status_category as keyof Omit<ApplicationFunnel, "total">] = row.n;
    }
    funnel.total += row.n;
  }

  const where = sql`a.user_id = ${userId} and a.board = ${board}`;
  const statusFilter = status ? sql` and a.status_category = ${status}` : sql``;
  const textFilter = q
    ? sql` and (a.title ilike ${"%" + q + "%"} or a.company ilike ${"%" + q + "%"})`
    : sql``;

  const [{ n: filteredTotal } = { n: 0 }] = (await conn.execute<{ n: number }>(sql`
    select count(*)::int as n from board_applications a
    where ${where}${statusFilter}${textFilter}
  `)) as unknown as { n: number }[];

  // NULLS LAST در هر دو جهت: ردیفی که تاریخ ندارد نباید بالای فهرست بنشیند.
  const orderBy = {
    applied: sql`a.applied_at`,
    posted: sql`l.posted_at`,
    status: sql`a.status_category`,
    company: sql`a.company`,
  }[sort];
  const direction = dir === "asc" ? sql`asc nulls last` : sql`desc nulls last`;

  const rows = (await conn.execute(sql`
    select a.*, l.posted_at as posted_at
    from board_applications a
    left join job_listings l on ${JOB_KEY_L} = ${JOB_KEY_A}
    where ${where}${statusFilter}${textFilter}
    order by ${orderBy} ${direction}, a.last_seen_at desc
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `)) as unknown as Record<string, unknown>[];

  const items: ApplicationRow[] = rows.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    board: r.board as string,
    externalId: r.external_id as string,
    title: (r.title as string | null) ?? null,
    company: (r.company as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    statusRaw: (r.status_raw as string | null) ?? null,
    statusCategory: r.status_category as ApplicationStatusCategory,
    appliedAt: r.applied_at ? new Date(r.applied_at as string) : null,
    lastSeenAt: new Date(r.last_seen_at as string),
    createdAt: new Date(r.created_at as string),
    postedAt: r.posted_at ? new Date(r.posted_at as string) : null,
  }));

  return {
    items,
    funnel,
    filteredTotal,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(filteredTotal / pageSize)),
  };
}
