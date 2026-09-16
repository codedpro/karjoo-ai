import "server-only";

/**
 * خواندنِ داده‌ی بخشِ «مدیریتِ کاربران» (server-only) — فقط-خواندنی.
 *
 * چرا این ماژول؟ تا امروز *هیچ* کوئری‌ای در اپ فراتر از «کاربرِ خودم» نبود؛ هر helper
 * با `where userId = ?` مقید بود. مدیریت به نمای «همه‌ی کاربران» نیاز دارد، پس این
 * ماژول تنها جایی است که آن مرز را عبور می‌کند — و به همین دلیل قواعدش سخت‌گیرانه است:
 *
 *   • فقط از پشتِ نگهبانِ ادمین (`requireAdmin`/`isDashboardAdmin`) فراخوانی می‌شود.
 *   • هرگز ستونِ حساس را select نمی‌کند: `onexaiApiKey` (کلیدِ مهرشده)، `tokenHash`ِ
 *     نشست‌ها، یا هر مادهٔ سری. فقط *وجودِ* آن‌ها به‌صورتِ بولین گزارش می‌شود.
 *   • موجودیِ کیف‌پول یک فراخوانیِ شبکه‌ای به 1xai است؛ پس *فقط* در صفحه‌ی جزئیاتِ یک
 *     کاربر خوانده می‌شود، نه در فهرست (وگرنه هر صفحه‌ی فهرست ۲۵ فراخوانیِ شبکه بود).
 *
 * صفحه‌بندی: کلید-محور نیست، `limit/offset` است — چون دامنه‌ی ادمین کوچک است و
 * پرش به صفحه‌ی دلخواه مهم‌تر از کارآییِ عمیق است.
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import {
  applications,
  authSessions,
  boardAccounts,
  matches,
  resumes,
  userServerAutoApply,
  users,
} from "@/db/schema";
import { readEntitlements } from "@/lib/billing/subscription";
import { getUnifiedBalance } from "@/lib/billing/unified";

/* ────────────────────────────────  انواع  ──────────────────────────────── */

/** یک ردیفِ فهرستِ کاربران — همان چیزی که جدولِ مدیریت نشان می‌دهد. */
export interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** نامِ اشتراکِ 1xai (منبعِ مزایای کارجو). */
  plan: string;
  /** آیا اشتراکِ پولی/هدیه‌ی معتبر دارد؟ */
  hasSubscription: boolean;
  planExpiresAt: Date | null;
  /** شناسه‌ی کاربر در 1xai — برای لینک به پنلِ مدیریتِ اشتراک. */
  onexaiUserId: number | null;
  isActive: boolean;
  createdAt: Date;
  /** تعدادِ اپلای‌های ثبت‌شده (هر وضعیتی). */
  applicationCount: number;
  /** آخرین باری که نشستی از این کاربر استفاده شد (تقریبی از «آخرین فعالیت»). */
  lastSeenAt: Date | null;
}

export interface AdminUsersPage {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** فیلترهای فهرست — همگی اختیاری و از query string می‌آیند. */
export interface AdminUsersQuery {
  /** جست‌وجو روی ایمیل/نام/نامِ پروفایل (بخشی، بدونِ حساسیت به حروف). */
  q: string;
  /** `active` | `suspended` | خالی برای همه. */
  status: string;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** query stringِ خام → فیلترهای معتبر (هرگز throw نمی‌کند؛ مقدارِ بد = پیش‌فرض). */
export function parseAdminUsersQuery(
  params: Record<string, string | string[] | undefined>,
): AdminUsersQuery {
  const first = (key: string): string => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" ? value.trim() : "";
  };

  const pageRaw = Number.parseInt(first("page"), 10);
  const sizeRaw = Number.parseInt(first("pageSize"), 10);

  return {
    q: first("q").slice(0, 120),
    status: first("status"),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    pageSize:
      Number.isFinite(sizeRaw) && sizeRaw > 0
        ? Math.min(sizeRaw, MAX_PAGE_SIZE)
        : PAGE_SIZE,
  };
}

/* ─────────────────────────────  فهرستِ کاربران  ──────────────────────────── */

/**
 * یک صفحه از کاربران را با فیلترها می‌خواند (تازه‌ترین ثبت‌نام اول).
 *
 * الگو: اول *صفحه‌ی* کاربران را می‌گیریم، بعد شمارنده‌ها را فقط برای همان شناسه‌ها
 * (`inArray`) در دو کوئریِ گروهی می‌خوانیم. این از N+1 و از join‌های سنگینِ سراسری
 * جلوگیری می‌کند.
 */
export async function listAdminUsers(
  query: AdminUsersQuery,
): Promise<AdminUsersPage> {
  const filters = [];

  if (query.q) {
    const needle = `%${query.q}%`;
    filters.push(
      or(
        ilike(users.email, needle),
        ilike(users.name, needle),
        ilike(users.fullName, needle),
      ),
    );
  }
  if (query.status === "active") filters.push(eq(users.isActive, true));
  if (query.status === "suspended") filters.push(eq(users.isActive, false));

  const where = filters.length ? and(...filters) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(where);

  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      onexaiUserId: users.onexaiUserId,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(query.pageSize)
    .offset((page - 1) * query.pageSize);

  const ids = rows.map((r) => r.id);
  const [applyCounts, lastSeen, subs] = await Promise.all([
    countApplicationsFor(ids),
    lastSeenFor(ids),
    subscriptionsFor(rows),
  ]);

  return {
    rows: rows.map((r) => ({
      ...r,
      ...subs.get(r.id)!,
      applicationCount: applyCounts.get(r.id) ?? 0,
      lastSeenAt: lastSeen.get(r.id) ?? null,
    })),
    total,
    page,
    pageSize: query.pageSize,
    pageCount,
  };
}

/** اشتراکِ 1xaiِ هر کاربر (کاربرِ بدونِ حسابِ 1xai → رایگان، بدونِ تماسِ شبکه). */
async function subscriptionsFor(
  rows: Array<{ id: string; onexaiUserId: number | null }>,
): Promise<Map<string, Pick<AdminUserRow, "plan" | "hasSubscription" | "planExpiresAt">>> {
  const entries = await Promise.all(
    rows.map(async (r) => {
      if (r.onexaiUserId === null) {
        return [r.id, { plan: "رایگان", hasSubscription: false, planExpiresAt: null }] as const;
      }
      const e = await readEntitlements(r.id);
      return [
        r.id,
        {
          plan: e.unavailable ? "نامعلوم" : e.planNameFa,
          hasSubscription: e.status === "active",
          planExpiresAt: e.periodEnd,
        },
      ] as const;
    }),
  );
  return new Map(entries);
}

async function countApplicationsFor(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ userId: applications.userId, n: count() })
    .from(applications)
    .where(inArray(applications.userId, ids))
    .groupBy(applications.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
}

/**
 * آخرین استفاده از نشست، به‌ازای هر کاربر.
 *
 * از `max()`ِ خودِ drizzle استفاده می‌کنیم و نه `sql<Date>\`max(…)\``: نتیجه‌ی یک
 * templateِ خام از mapperِ ستون رد *نمی‌شود*، پس درایور یک **رشته** برمی‌گرداند در حالی
 * که تایپ ادعا می‌کند Date است — یعنی تایپ دروغ می‌گوید و اولین `.getTime()` در زمانِ
 * اجرا می‌ترکد. `max()` تایپ و نگاشتِ ستون را حفظ می‌کند.
 */
async function lastSeenFor(ids: string[]): Promise<Map<string, Date | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      userId: authSessions.userId,
      lastUsedAt: max(authSessions.lastUsedAt),
    })
    .from(authSessions)
    .where(inArray(authSessions.userId, ids))
    .groupBy(authSessions.userId);
  return new Map(rows.map((r) => [r.userId, r.lastUsedAt ?? null]));
}

/* ───────────────────────────  جزئیاتِ یک کاربر  ──────────────────────────── */

export interface AdminUserActivityRow {
  id: string;
  status: string;
  channel: string | null;
  matchScore: number | null;
  createdAt: Date;
  submittedAt: Date | null;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  /** موجودیِ کیفِ پولِ واحد به تومان — `null` یعنی 1xai در دسترس نبود. */
  balanceToman: number | null;
  matchCount: number;
  resumeCount: number;
  /** نشست‌های زنده‌ی وب/افزونه (نه منقضی، نه باطل‌شده). */
  activeSessions: number;
  /** آیا اپلای خودکارِ سمتِ سرور برای این کاربر روشن است؟ */
  serverAutoApply: boolean;
  /** بردهای متصل — فقط نامِ برد و وضعیت، بدونِ هیچ نشستی. */
  boards: Array<{ board: string; status: string }>;
  recentApplications: AdminUserActivityRow[];
}

/** جزئیاتِ یک کاربر برای صفحه‌ی مدیریت، یا `null` اگر کاربر وجود ندارد. */
export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      onexaiUserId: users.onexaiUserId,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const now = new Date();
  const [
    applyCounts,
    lastSeen,
    matchCountRows,
    resumeCountRows,
    sessionRows,
    autoApplyRows,
    boardRows,
    recentApplications,
    subs,
    balanceToman,
  ] = await Promise.all([
    countApplicationsFor([userId]),
    lastSeenFor([userId]),
    db.select({ n: count() }).from(matches).where(eq(matches.userId, userId)),
    db.select({ n: count() }).from(resumes).where(eq(resumes.userId, userId)),
    db
      .select({ n: count() })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          // با `gt` و نه templateِ خام: مقایسه‌ی تاریخ باید از mapperِ ستون رد شود،
          // وگرنه درایور یک شیءِ Date خام می‌گیرد و کوئری در زمانِ اجرا می‌ترکد.
          gt(authSessions.expiresAt, now),
        ),
      ),
    db
      .select({ enabled: userServerAutoApply.enabled })
      .from(userServerAutoApply)
      .where(eq(userServerAutoApply.userId, userId))
      .limit(1),
    db
      .select({ board: boardAccounts.board, status: boardAccounts.status })
      .from(boardAccounts)
      .where(eq(boardAccounts.userId, userId)),
    db
      .select({
        id: applications.id,
        status: applications.status,
        channel: applications.channel,
        matchScore: applications.matchScore,
        createdAt: applications.createdAt,
        submittedAt: applications.submittedAt,
      })
      .from(applications)
      .where(eq(applications.userId, userId))
      .orderBy(desc(applications.createdAt))
      .limit(20),
    subscriptionsFor([row]),
    // موجودی از 1xai می‌آید (شبکه). اگر در دسترس نبود، صفحه نباید بشکند.
    // `availableToman` (موجودی منهای بلوکه‌شده) همان عددی است که کاربر هم می‌بیند.
    getUnifiedBalance(userId)
      .then((b) => b.availableToman)
      .catch(() => null),
  ]);

  return {
    user: {
      ...row,
      ...subs.get(userId)!,
      applicationCount: applyCounts.get(userId) ?? 0,
      lastSeenAt: lastSeen.get(userId) ?? null,
    },
    balanceToman,
    matchCount: Number(matchCountRows[0]?.n ?? 0),
    resumeCount: Number(resumeCountRows[0]?.n ?? 0),
    activeSessions: Number(sessionRows[0]?.n ?? 0),
    serverAutoApply: autoApplyRows[0]?.enabled ?? false,
    boards: boardRows,
    recentApplications,
  };
}

/* ───────────────────────────  هویتِ کاربران  ─────────────────────────────── */

/** حداقلِ هویتِ نمایشیِ یک کاربر — برای جایی که فقط `userId` داریم. */
export interface AdminUserIdentity {
  id: string;
  email: string | null;
  name: string | null;
  fullName: string | null;
}

/**
 * چند `userId` → هویتِ نمایشی‌شان (یک کوئری، نه N تا).
 *
 * چرا لازم شد؟ صفحه‌ی «پرداخت‌ها» فقط `userId`ِ خام را نشان می‌داد؛ ادمین باید UUID را
 * با یک انسان تطبیق می‌داد. حالا نام/ایمیل کنارِ هر درخواست دیده می‌شود.
 */
export async function getUserIdentities(
  ids: string[],
): Promise<Map<string, AdminUserIdentity>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      fullName: users.fullName,
    })
    .from(users)
    .where(inArray(users.id, Array.from(new Set(ids))));
  return new Map(rows.map((r) => [r.id, r]));
}

/* ────────────────────────────  آمارِ سرصفحه  ─────────────────────────────── */

export interface AdminUserStats {
  total: number;
  suspended: number;
  /** کاربرانی که در ۳۰ روز گذشته ثبت‌نام کرده‌اند. */
  newLast30d: number;
  /** کاربرانی که اشتراکِ فعالِ 1xai دارند. */
  paying: number;
}

/** چهار عددِ بالای صفحه‌ی مدیریتِ کاربران. */
export async function getAdminUserStats(): Promise<AdminUserStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [totalRows, suspendedRows, newRows, payingRows] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(users).where(eq(users.isActive, false)),
    db
      .select({ n: count() })
      .from(users)
      // `gte` و نه templateِ خام — همان دلیلِ بالا (Date باید از mapperِ ستون رد شود).
      .where(gte(users.createdAt, since)),
    db
      .select({ id: users.id, onexaiUserId: users.onexaiUserId })
      .from(users)
      .where(isNotNull(users.onexaiUserId)),
  ]);
  // اشتراک در 1xai است؛ فقط کاربرانِ متصل ممکن است اشتراک داشته باشند (نتیجه ۶۰ ثانیه کش می‌شود).
  const subs = await subscriptionsFor(payingRows);

  return {
    total: Number(totalRows[0]?.n ?? 0),
    suspended: Number(suspendedRows[0]?.n ?? 0),
    newLast30d: Number(newRows[0]?.n ?? 0),
    paying: [...subs.values()].filter((v) => v.hasSubscription).length,
  };
}
