import "server-only";

/**
 * کشفِ آگهی ۲۴/۷ روی نودِ ناوگان — سمتِ کنترل‌پلین.
 *
 * تا این‌جا فقط افزونه کشف می‌کرد (یا جابینجا از سمتِ کنترل‌پلین، که از IPِ
 * غیرِایرانی قابلِ اتکا نیست). یعنی مرورگرِ کاربر که بسته می‌شد، صفِ چهار سایت دیگر
 * پر نمی‌شد و نود چیزی برای اپلای نداشت. حالا نود همان جست‌وجوی افزونه را از IPِ
 * ایرانی، بی‌وقفه اجرا می‌کند.
 *
 * تقسیمِ کار عمداً این است: **کنترل‌پلین تصمیم می‌گیرد، نود فقط اجرا می‌کند.**
 * نود بی‌اعتماد و بی‌دیتابیس است؛ نمی‌داند صفِ کاربر چقدر پر است، افزونه‌اش زنده است
 * یا نه، یا آخرین بار کِی جست‌وجو شده. پس همه‌ی گیت‌ها این‌جا هستند:
 *
 *   ۱) کاربر به همین نود تخصیص یافته باشد (هرگز cross-node).
 *   ۲) افزونه‌ی زنده‌ای مالکِ صف نباشد — آن خودش کشف می‌کند؛ دوبار جست‌وجو یعنی دوبار
 *      بار روی سایت.
 *   ۳) پلن و تاگلِ اپلای خودکارِ سرور اجازه بدهد.
 *   ۴) فیلترها متوقف نباشند.
 *   ۵) صف کمتر از سقف باشد — وقتی هزاران آگهی منتظرند، کمبود اپلای است نه کمبودِ کشف.
 *   ۶) نوبتش رسیده باشد (هر ۱۵ دقیقه) — و این نوبت *اتمیک* گرفته می‌شود تا دو نود
 *      هم‌زمان یک کاربر را جست‌وجو نکنند.
 *
 * نتیجه‌ها از همان مسیری ثبت می‌شوند که افزونه استفاده می‌کند
 * (`enqueueBrowserDiscoveredListings`)، پس فیلترِ تازگی، جنسیت و ضدِتکرار دقیقاً یکی است.
 *
 * §۱۰: کشف **ناشناس** است — بدونِ نشستِ کاربر، با UAِ صادقانه‌ی KarjooBot و با رعایتِ
 * robots.txt (سمتِ نود). نشستِ کاربر فقط برای خودِ اپلای خرج می‌شود؛ ده‌ها جست‌وجوی
 * خودکار زیرِ حسابِ کاربر همان رفتاری است که حساب را به چشم می‌آورد.
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { userServerAutoApply } from "@/db/schema";
import { HttpError } from "@/lib/api/http";
import { assertServerAutoApplyAllowed } from "@/lib/apply/auto-apply";
import {
  discoveryBoardSpecs,
  toJobListings,
  type DiscoveredListingInput,
  type DiscoveryBoard,
  type DiscoveryBoardSpec,
} from "@/lib/apply/discovery-specs";
import { canServerExecute } from "@/lib/apply/execution-run";
import { readApplyFilters, readJobPreferences } from "@/lib/apply/filters";
import {
  enqueueBrowserDiscoveredListings,
  persistCatalogListings,
  type BrowserDiscoveryReport,
  type CatalogIngestReport,
} from "@/lib/apply/orchestrator";
import { getJobvisionCatalog } from "@/lib/apply/boards/jobvision-catalog";
import { readEntitlements } from "@/lib/billing/subscription";
import { listUserIdsForNode } from "@/lib/fleet/assign";
import { logger } from "@/lib/observability/logger";

type Db = typeof defaultDb;

/** هر کاربر حداکثر هر ۱۵ دقیقه یک‌بار جست‌وجو می‌شود. */
export const FLEET_DISCOVERY_INTERVAL_MINUTES = 15;

/**
 * بالاتر از این تعداد وظیفه‌ی منتظر، کشف نمی‌کنیم. همان عددِ افزونه — آن‌جا نشان داده
 * بود که کشفِ بی‌سقف حلقه‌ی اپلای را گرسنه می‌کند.
 */
export const FLEET_DISCOVERY_QUEUE_CEILING = 300;

/** یک کاربرِ آماده‌ی کشف، با مشخصاتِ جست‌وجوی سایت‌های فعالش. */
export interface FleetDiscoveryUser {
  userId: string;
  maxAgeDays: number;
  boards: DiscoveryBoardSpec[];
}

/**
 * JobVision category key → Persian label, cached for an hour.
 *
 * The node matches JobVision postings by their schema.org occupationalCategory,
 * which is the Persian label (verified: every key the filter UI offers resolves,
 * and posting pages use the same strings). One catalog fetch serves every user.
 */
let jobvisionLabelCache: { at: number; byKey: Map<string, string> } | null = null;
const JOBVISION_LABEL_TTL_MS = 60 * 60_000;

async function jobvisionLabels(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  if (!jobvisionLabelCache || Date.now() - jobvisionLabelCache.at > JOBVISION_LABEL_TTL_MS) {
    const catalog = await getJobvisionCatalog();
    jobvisionLabelCache = {
      at: Date.now(),
      byKey: new Map(catalog.categories.map((c) => [c.key, c.label])),
    };
  }
  const byKey = jobvisionLabelCache.byKey;
  return keys.map((key) => byKey.get(key)).filter((label): label is string => Boolean(label));
}

export interface FleetDiscoveryDeps {
  db?: Db;
  readAssignedUserIds?: (nodeId: string) => Promise<string[]>;
  canExecute?: (userId: string) => Promise<boolean>;
  isAllowed?: (userId: string) => Promise<boolean>;
  pendingCount?: (userId: string) => Promise<number>;
  claimTurn?: (userId: string) => Promise<boolean>;
  jobvisionLabels?: (keys: string[]) => Promise<string[]>;
}

async function defaultIsAllowed(userId: string, db: Db): Promise<boolean> {
  try {
    await assertServerAutoApplyAllowed(userId, await readEntitlements(userId), { db });
    return true;
  } catch {
    // پلنِ بی‌ورکر، تاگلِ خاموش یا سقفِ پر — رفتارِ موردِ انتظار، بی‌سروصدا رد.
    return false;
  }
}

async function defaultPendingCount(userId: string, db: Db): Promise<number> {
  const rows = (await db.execute(sql`
    select count(*)::int as n
      from tasks t
      join matches m on m.id = t.match_id
     where m.user_id = ${userId}
       and t.status = 'pending'
  `)) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * نوبتِ کشفِ این کاربر را اتمیک برمی‌دارد: فقط اگر از آخرین کشف بیش از بازه گذشته
 * باشد، `last_discovery_at` را همین حالا می‌کند و true برمی‌گرداند. دو نود (یا دو
 * درخواستِ هم‌زمان) هرگز هر دو true نمی‌گیرند.
 *
 * همان ستونی است که زمان‌بندِ کشفِ کنترل‌پلین هم برای چرخش استفاده می‌کند؛ پس کشفِ
 * ناوگان و آن زمان‌بند هم دیگر را تکرار نمی‌کنند.
 */
async function defaultClaimTurn(userId: string, db: Db): Promise<boolean> {
  const rows = await db
    .update(userServerAutoApply)
    .set({ lastDiscoveryAt: new Date() })
    .where(
      and(
        eq(userServerAutoApply.userId, userId),
        or(
          isNull(userServerAutoApply.lastDiscoveryAt),
          lt(
            userServerAutoApply.lastDiscoveryAt,
            new Date(Date.now() - FLEET_DISCOVERY_INTERVAL_MINUTES * 60_000),
          ),
        ),
      ),
    )
    .returning({ userId: userServerAutoApply.userId });
  return rows.length > 0;
}

/**
 * کاربرانِ این نود که الان باید کشف شوند، با مشخصاتِ جست‌وجوی هر سایت.
 *
 * ترتیبِ گیت‌ها عمداً از ارزان به گران است، و «برداشتنِ نوبت» آخر از همه — تا
 * کاربری که به هر دلیلِ دیگری رد می‌شود، نوبتش بی‌دلیل مصرف نشود.
 */
export async function claimFleetDiscovery(
  nodeId: string,
  deps: FleetDiscoveryDeps = {},
): Promise<FleetDiscoveryUser[]> {
  const db = deps.db ?? defaultDb;
  const readAssigned = deps.readAssignedUserIds ?? ((id: string) => listUserIdsForNode(id, db));
  const canExecute = deps.canExecute ?? ((id: string) => canServerExecute(id, db));
  const isAllowed = deps.isAllowed ?? ((id: string) => defaultIsAllowed(id, db));
  const pendingCount = deps.pendingCount ?? ((id: string) => defaultPendingCount(id, db));
  const claimTurn = deps.claimTurn ?? ((id: string) => defaultClaimTurn(id, db));

  const out: FleetDiscoveryUser[] = [];
  for (const userId of await readAssigned(nodeId)) {
    try {
      if (!(await canExecute(userId))) continue;
      if (!(await isAllowed(userId))) continue;

      const filters = await readApplyFilters(userId, db);
      if (filters.paused) continue;

      const boards = discoveryBoardSpecs(filters, await readJobPreferences(userId, db)).filter(
        (spec) => spec.enabled && spec.hasTargeting,
      );
      if (boards.length === 0) continue;

      if ((await pendingCount(userId)) >= FLEET_DISCOVERY_QUEUE_CEILING) continue;
      if (!(await claimTurn(userId))) continue;

      // JobVision is matched on the node by label; resolve it here. If the
      // catalog is unreachable the board is dropped for this turn rather than
      // sent with no categories — which the node would read as "match anything".
      const resolved: DiscoveryBoardSpec[] = [];
      for (const spec of boards) {
        if (spec.board !== "jobvision" || !spec.categoryKeys?.length) {
          resolved.push(spec);
          continue;
        }
        try {
          const labels = await (deps.jobvisionLabels ?? jobvisionLabels)(spec.categoryKeys);
          if (labels.length > 0) resolved.push({ ...spec, categoryLabels: labels });
        } catch {
          /* catalog down — skip JobVision this turn */
        }
      }
      if (resolved.length > 0) out.push({ userId, maxAgeDays: filters.maxAgeDays, boards: resolved });
    } catch (err) {
      // یک کاربرِ خراب نباید کشفِ بقیه‌ی کاربرانِ این نود را متوقف کند.
      logger.warn("fleet discovery skipped a user", {
        path: "fleet/discovery",
        nodeId,
        userId,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }
  return out;
}

/**
 * آگهی‌هایی که نود برای یک کاربر پیدا کرده را به صفِ همان کاربر می‌برد.
 *
 * userId از بدنه می‌آید، پس **حتماً** بررسی می‌شود که به همین نود تخصیص یافته باشد —
 * وگرنه یک نود می‌توانست برای کاربرِ دلخواه وظیفه بسازد.
 */
export async function ingestFleetDiscovery(
  nodeId: string,
  userId: string,
  board: DiscoveryBoard,
  items: DiscoveredListingInput[],
  deps: { db?: Db; readAssignedUserIds?: (nodeId: string) => Promise<string[]> } = {},
): Promise<BrowserDiscoveryReport> {
  const db = deps.db ?? defaultDb;
  const assigned = await (deps.readAssignedUserIds ?? ((id: string) => listUserIdsForNode(id, db)))(
    nodeId,
  );
  if (!assigned.includes(userId)) throw new HttpError(403, "user is not assigned to this node");
  return enqueueBrowserDiscoveredListings(userId, toJobListings(board, items), db, "fleet");
}

/** آگهی‌های کاتالوگِ عمومی — فقط ثبت، بدونِ هیچ کاربر یا وظیفه‌ای. */
export async function ingestFleetCatalog(
  board: DiscoveryBoard,
  items: DiscoveredListingInput[],
  deps: { db?: Db } = {},
): Promise<CatalogIngestReport> {
  return persistCatalogListings(toJobListings(board, items), deps.db ?? defaultDb);
}
