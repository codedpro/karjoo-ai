import "server-only";

/**
 * GET /api/admin/fleet
 *
 * نمای ادمینِ ناوگانِ اپلای (Track A): فهرستِ نودها (با وضعیت/سلامت) + تخصیص‌هایشان.
 * با رازِ مشترکِ داخلی محافظت می‌شود (مثلِ /api/internal/*): هدرِ X-Internal-Secret؛
 * اگر رازِ سرور تنظیم نشده باشد fail-closed (۵۰۳).
 *
 * هرگز hashِ اعتبارنامه/توکن را برنمی‌گرداند (publicNode آن‌ها را حذف می‌کند).
 *
 * پاسخ: { nodes: [{ ...publicNode, assignments: [{ id, userId, createdAt }] }] }
 */
import { desc } from "drizzle-orm";

import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { publicNode } from "@/lib/api/fleet-node-view";
import { db } from "@/db";
import { workerNodes, workerAssignments } from "@/db/schema";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ داخلی (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) نودها (تازه‌ترین اول) + همه‌ی تخصیص‌ها.
    const nodes = await db
      .select()
      .from(workerNodes)
      .orderBy(desc(workerNodes.lastSeenAt));

    const assignments = await db
      .select({
        id: workerAssignments.id,
        userId: workerAssignments.userId,
        nodeId: workerAssignments.nodeId,
        createdAt: workerAssignments.createdAt,
      })
      .from(workerAssignments);

    // ۳) تخصیص‌ها را بر اساسِ nodeId گروه کن.
    const byNode = new Map<
      string,
      { id: string; userId: string; createdAt: Date }[]
    >();
    for (const a of assignments) {
      const list = byNode.get(a.nodeId) ?? [];
      list.push({ id: a.id, userId: a.userId, createdAt: a.createdAt });
      byNode.set(a.nodeId, list);
    }

    return json({
      nodes: nodes.map((n) => ({
        ...publicNode(n),
        assignments: byNode.get(n.id) ?? [],
      })),
    });
  });
}
