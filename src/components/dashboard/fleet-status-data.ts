import "server-only";

/**
 * خواندنِ «وضعیتِ اپلای خودکارِ کارگرِ سرور» برای پنلِ premium کاربر (Track C).
 *
 * همه فقط-خواندنی و مقید به userId (قاعده‌ی ۴: داده‌ی هر کاربر فقط برای همان کاربر).
 * این لایه «مصرف‌کننده» است و چیزی نمی‌نویسد:
 *   • پلنِ کاربر را از plan-data می‌گیرد و قابلیتِ کارگرِ سرور (سقفِ IP) را تعیین می‌کند،
 *   • تعدادِ نودهای *تخصیص‌یافته به همین کاربر* را از هسته‌ی Foundation (listAssignments)
 *     می‌شمارد (کدام کارگرها برای او اپلای می‌کنند — هرگز نودِ کاربرِ دیگر)،
 *   • تازگیِ نشستِ خزانه را *فقط از متادیتای زمان‌بندی* جمع‌بندی می‌کند (هرگز ciphertext).
 *
 * هیچ ستونِ حساسی (نشست/کلید/اعتبارنامه) خوانده نمی‌شود؛ فقط شمارش/متادیتا.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { boardAccounts, sessionBlobs } from "@/db/schema";
import { listAssignments } from "@/lib/fleet/assign";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import {
  planFleetCapability,
  summarizeSessionFreshness,
  type PlanFleetCapability,
  type SessionFreshness,
} from "@/components/dashboard/fleet-labels";

/** بسته‌ی داده‌ی پنلِ وضعیتِ اپلای خودکارِ کارگرِ سرور. */
export interface FleetStatusData {
  /** قابلیتِ کارگرِ سرورِ پلنِ کاربر (آیا کارگر دارد + سقفِ IP). */
  capability: PlanFleetCapability;
  /** تعدادِ نودهای کارگرِ هم‌اکنون‌تخصیص‌یافته به این کاربر. */
  assignedNodes: number;
  /** خلاصه‌ی تازگیِ نشستِ خزانه (برای پیامِ «نشست تازه است/نیاز به تازه‌سازی»). */
  freshness: SessionFreshness;
}

/**
 * تازگیِ نشستِ خزانه‌ی کاربر را *فقط از متادیتای زمان‌بندی* جمع می‌زند. مقید به userId.
 * هرگز ciphertext/iv/keyVersion خوانده نمی‌شود (همان مرزِ /api/session/status).
 */
async function readSessionFreshness(
  userId: string,
  now: number,
): Promise<SessionFreshness> {
  const accounts = await db
    .select({ id: boardAccounts.id })
    .from(boardAccounts)
    .where(eq(boardAccounts.userId, userId));

  if (accounts.length === 0) {
    return summarizeSessionFreshness([]);
  }

  const states: { stale: boolean }[] = [];
  for (const acc of accounts) {
    const [blob] = await db
      .select({ expiresAt: sessionBlobs.expiresAt })
      .from(sessionBlobs)
      .innerJoin(boardAccounts, eq(sessionBlobs.boardAccountId, boardAccounts.id))
      .where(
        and(
          eq(sessionBlobs.boardAccountId, acc.id),
          eq(boardAccounts.userId, userId),
        ),
      )
      .orderBy(desc(sessionBlobs.lastRefreshed))
      .limit(1);

    const connected = Boolean(blob);
    const expiresAt = blob?.expiresAt ?? null;
    const stale = !connected || (expiresAt ? expiresAt.getTime() <= now : false);
    states.push({ stale });
  }

  return summarizeSessionFreshness(states);
}

/**
 * همه‌ی داده‌ی پنلِ وضعیتِ کارگرِ سرور را می‌سازد: قابلیتِ پلن، تعدادِ نودهای تخصیص‌یافته،
 * و تازگیِ نشست. مقید به userId (قاعده‌ی ۴). هیچ چیزی نمی‌نویسد.
 *
 * @param now زمانِ مرجع — تزریقی برای تستِ قطعی.
 */
export async function getFleetStatusData(
  userId: string,
  now: number = Date.now(),
): Promise<FleetStatusData> {
  const planStatus = await getUserPlanStatus(userId, now);
  const capability = planFleetCapability(planStatus.rawPlan);

  // پلن‌های بدونِ کارگر (Free/Pro): تخصیص و تازگیِ نشست را اصلاً کوئری نمی‌کنیم (مسیرِ ارزان).
  if (!capability.hasWorkerAutoApply) {
    return {
      capability,
      assignedNodes: 0,
      freshness: summarizeSessionFreshness([]),
    };
  }

  const [assignments, freshness] = await Promise.all([
    listAssignments(userId),
    readSessionFreshness(userId, now),
  ]);

  return {
    capability,
    assignedNodes: assignments.length,
    freshness,
  };
}
