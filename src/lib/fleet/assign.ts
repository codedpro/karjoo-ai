import "server-only";

/**
 * تخصیصِ نودِ ورکر به کاربر (server-only) — قاعده‌ی ۲ (سقفِ IP بر اساسِ پلن).
 *
 * یک نود به کاربر تخصیص می‌یابد تا «به‌جای او» اپلای کند. هر کاربر حداکثر
 * workerIpLimitFor(plan) نود می‌تواند داشته باشد (Max=۱، MaxPlus=۵؛ Free/Pro=۰ → هیچ
 * اپلای خودکارِ ورکری، فقط افزونه). سقف *هنگامِ تخصیص* اعمال می‌شود:
 *   • اگر سقفِ پلن ۰ باشد → WorkerIpLimitError (این پلن ورکر ندارد).
 *   • اگر تعدادِ تخصیص‌های فعلیِ کاربر ≥ سقف باشد → WorkerIpLimitError.
 *
 * مرزِ ایمنی: شمارش و تخصیص در یک تراکنش انجام می‌شوند تا دو تخصیصِ همزمان نتوانند هر دو
 * از سقف عبور کنند (شمارش سپس درج، اتمیک). جفتِ (userId, nodeId) یکتاست (idempotent).
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند (db/plan) تا بدونِ DB/شبکه‌ی زنده تست شوند.
 */
import { and, eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  workerAssignments,
  workerNodes,
  type Plan,
  type WorkerAssignment,
} from "@/db/schema";
import { workerIpLimitFor } from "@/lib/billing/plans";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد. */
export type FleetAssignDb = typeof defaultDb;

/**
 * خطای typed: تخصیص از سقفِ IPِ پلن عبور می‌کند (یا پلن اصلاً ورکر ندارد). مسیر باید
 * این را به ۴۰۳/۴۰۹ نگاشت کند. limit/assigned برای پیامِ دقیقِ UI حمل می‌شوند.
 */
export class WorkerIpLimitError extends Error {
  readonly code = "worker_ip_limit_exceeded" as const;
  /** سقفِ IPِ ورکرِ این پلن (Free/Pro=۰، Max=۱، MaxPlus=۵). */
  readonly limit: number;
  /** تعدادِ نودهای از پیش‌تخصیص‌یافته به این کاربر. */
  readonly assigned: number;

  constructor(args: { limit: number; assigned: number; message?: string }) {
    super(
      args.message ??
        (args.limit === 0
          ? "پلنِ این کاربر اپلای خودکارِ ورکر ندارد (سقفِ IP = ۰)."
          : `به سقفِ نودهای ورکرِ این پلن رسیده‌اید (${args.assigned}/${args.limit}).`),
    );
    this.name = "WorkerIpLimitError";
    this.limit = args.limit;
    this.assigned = args.assigned;
  }
}

/**
 * یک نود را به کاربر تخصیص می‌دهد و سقفِ IPِ پلن را اعمال می‌کند.
 *
 * گام‌ها (در یک تراکنش، اتمیک):
 *   ۱) سقفِ پلن را از workerIpLimitFor بگیر؛ اگر ۰ بود → WorkerIpLimitError (پلن بی‌ورکر).
 *   ۲) تخصیص‌های فعلیِ کاربر را بشمار؛ اگر ≥ سقف → WorkerIpLimitError.
 *   ۳) ردیفِ تخصیص را درج کن (یکتا روی (userId, nodeId) — تخصیصِ تکراری idempotent است).
 *
 * نکته‌ی idempotency: اگر همین (کاربر، نود) از قبل تخصیص یافته باشد، insert با
 * onConflictDoNothing بی‌اثر می‌ماند و ردیفِ موجود برگردانده می‌شود — *بدونِ* احتسابِ آن
 * در سقف (چون نودِ تکراری ظرفیتِ تازه مصرف نمی‌کند). شمارش پیش از درج، نودِ موجود را هم
 * می‌بیند، پس re-assign هرگز از سقف رد نمی‌شود.
 *
 * @param userId کاربری که نود برایش اپلای می‌کند (همیشه از نشست — قاعده‌ی امنیت).
 * @param nodeId نودِ ورکر (worker_nodes.id).
 * @param plan   پلنِ کاربر (از users.plan) — سقف از plans.ts.
 * @throws WorkerIpLimitError اگر پلن ورکر نداشته باشد یا سقف پر باشد.
 */
export async function assignNodeToUser(
  userId: string,
  nodeId: string,
  plan: Plan,
  conn: FleetAssignDb = defaultDb,
): Promise<WorkerAssignment> {
  const limit = workerIpLimitFor(plan);

  return conn.transaction(async (tx) => {
    // اگر این (کاربر، نود) از قبل تخصیص یافته، همان را برگردان (idempotent، بدونِ سقف‌شکنی).
    const [existing] = await tx
      .select()
      .from(workerAssignments)
      .where(
        and(
          eq(workerAssignments.userId, userId),
          eq(workerAssignments.nodeId, nodeId),
        ),
      )
      .limit(1);
    if (existing) return existing;

    // پلنِ بی‌ورکر → همیشه رد (حتی اولین نود).
    if (limit <= 0) {
      throw new WorkerIpLimitError({ limit, assigned: 0 });
    }

    // تعدادِ نودهای فعلیِ کاربر را بشمار (داخلِ همان تراکنش).
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(workerAssignments)
      .where(eq(workerAssignments.userId, userId));
    const assigned = n ?? 0;

    if (assigned >= limit) {
      throw new WorkerIpLimitError({ limit, assigned });
    }

    const [row] = await tx
      .insert(workerAssignments)
      .values({ userId, nodeId })
      .onConflictDoNothing({
        target: [workerAssignments.userId, workerAssignments.nodeId],
      })
      .returning();

    // در حالتِ نادرِ رقابت (همان جفت بینِ select و insert درج شد)، ردیفِ موجود را بخوان.
    if (row) return row;
    const [raced] = await tx
      .select()
      .from(workerAssignments)
      .where(
        and(
          eq(workerAssignments.userId, userId),
          eq(workerAssignments.nodeId, nodeId),
        ),
      )
      .limit(1);
    return raced;
  });
}

/**
 * تخصیصِ یک نود از یک کاربر را حذف می‌کند (idempotent — اگر نباشد، false).
 * @returns true اگر ردیفی حذف شد.
 */
export async function unassignNodeFromUser(
  userId: string,
  nodeId: string,
  conn: FleetAssignDb = defaultDb,
): Promise<boolean> {
  const deleted = await conn
    .delete(workerAssignments)
    .where(
      and(
        eq(workerAssignments.userId, userId),
        eq(workerAssignments.nodeId, nodeId),
      ),
    )
    .returning({ id: workerAssignments.id });
  return deleted.length > 0;
}

/** فهرستِ تخصیص‌های یک کاربر (کدام نودها برایش اپلای می‌کنند). */
export async function listAssignments(
  userId: string,
  conn: FleetAssignDb = defaultDb,
): Promise<WorkerAssignment[]> {
  return conn
    .select()
    .from(workerAssignments)
    .where(eq(workerAssignments.userId, userId));
}

/**
 * وقتی کاربر «اپلای خودکار روی سرور» را روشن می‌کند، **خودکار** یک نودِ سالم به او تخصیص
 * می‌دهد — اگر هنوز هیچ نودی ندارد.
 *
 * چرا لازم است: `claimFleetJobs` برای نودی که هیچ کاربرِ تخصیص‌یافته‌ای ندارد بلافاصله
 * `[]` برمی‌گرداند. پس بدونِ تخصیص، کاربر تاگل را روشن می‌کند، صف پُر می‌شود و **هیچ‌وقت
 * تخلیه نمی‌شود**؛ تخصیص تا امروز فقط دستی/ادمین بود. این تابع آن حلقه را می‌بندد.
 *
 * انتخابِ نود: سالم‌ترین و کم‌بارترین — فقط `health='online'`، و بینِ آن‌ها نودی که
 * کمترین کاربرِ تخصیص‌یافته را دارد و هنوز به `capacity` خودش نرسیده.
 *
 * fail-soft: اگر هیچ نودِ آزادی نبود `null` برمی‌گرداند (تاگل باز هم روشن می‌شود و کاربر
 * در صف می‌مانَد) — روشن‌کردنِ تاگل نباید به‌خاطرِ نبودِ ظرفیتِ ناوگان شکست بخورد. سقفِ
 * IPِ پلن همچنان توسطِ `assignNodeToUser` اعمال می‌شود (پلنِ بی‌ورکر → null).
 */
export async function autoAssignNodeForUser(
  userId: string,
  plan: Plan,
  conn: FleetAssignDb = defaultDb,
): Promise<WorkerAssignment | null> {
  // پلنِ بی‌ورکر (Free/Pro) → اصلاً تلاش نکن.
  if (workerIpLimitFor(plan) <= 0) return null;

  // از قبل نود دارد → کارِ تازه‌ای لازم نیست (idempotent).
  const existing = await listAssignments(userId, conn);
  if (existing.length > 0) return existing[0]!;

  // نودهای online که هنوز ظرفیتِ خالی دارند، کم‌بارترین اول.
  const load = conn
    .select({
      nodeId: workerAssignments.nodeId,
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(workerAssignments)
    .groupBy(workerAssignments.nodeId)
    .as("load");

  const candidates = await conn
    .select({ id: workerNodes.id })
    .from(workerNodes)
    .leftJoin(load, eq(load.nodeId, workerNodes.id))
    .where(
      and(
        eq(workerNodes.health, "online"),
        sql`coalesce(${load.n}, 0) < ${workerNodes.capacity}`,
      ),
    )
    .orderBy(sql`coalesce(${load.n}, 0) asc`)
    .limit(1);

  const node = candidates[0];
  if (!node) return null;

  try {
    return await assignNodeToUser(userId, node.id, plan, conn);
  } catch (err) {
    // سقفِ پلن یا رقابتِ هم‌زمان → تاگل را نمی‌شکنیم؛ فقط تخصیص نداده‌ایم.
    if (err instanceof WorkerIpLimitError) return null;
    throw err;
  }
}

/** فهرستِ کاربرانِ تخصیص‌یافته به یک نود (برای dispatch — کدام کاربرها روی این نودند). */
export async function listUserIdsForNode(
  nodeId: string,
  conn: FleetAssignDb = defaultDb,
): Promise<string[]> {
  const rows = await conn
    .select({ userId: workerAssignments.userId })
    .from(workerAssignments)
    .where(eq(workerAssignments.nodeId, nodeId));
  return rows.map((r) => r.userId);
}
