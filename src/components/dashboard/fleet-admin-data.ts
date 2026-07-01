import "server-only";

/**
 * خواندنِ داده‌ی نمای ادمینِ ناوگان (server-only) — Track C.
 *
 * فقط-خواندنی. فهرستِ نودهای ورکر را با سلامت/نسخه/آخرین دیده‌شدن و کاربرانِ تخصیص‌یافته
 * می‌خواند تا ادمین وضعیتِ ناوگان را ببیند. مرزِ امنیت:
 *   • هرگز ستونِ حساس (credentialHash/enrollmentTokenHash) برنمی‌گرداند — فقط متادیتای دید.
 *   • فقط از پشتِ نگهبانِ ادمین (isFleetAdmin) فراخوانی می‌شود؛ خودش راز نمی‌خواند.
 */
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { users, workerAssignments, workerNodes } from "@/db/schema";

/** یک کاربرِ تخصیص‌یافته به یک نود (برای نمایشِ «چه کسی روی این نود است»).
 *
 * هویت اکنون حسابِ Google است؛ برای نمایش از `email`/`name` استفاده می‌شود (نه phone).
 */
export interface AssignedUserRow {
  userId: string;
  email: string | null;
  name: string | null;
  fullName: string | null;
  plan: string;
}

/** یک ردیفِ نمای ادمینِ نود — فقط متادیتای دید (هیچ مادهٔ سری). */
export interface FleetNodeRow {
  id: string;
  nodeKey: string;
  region: string | null;
  health: string;
  capacity: number;
  agentVersion: string | null;
  ipAddress: string | null;
  /** آیا نود ثبت‌نام شده (اعتبارنامه دارد)؟ — بدونِ افشای خودِ هش. */
  enrolled: boolean;
  lastHeartbeat: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  /** کاربرانِ هم‌اکنون‌تخصیص‌یافته به این نود. */
  assignedUsers: AssignedUserRow[];
}

/**
 * فهرستِ همه‌ی نودهای ورکر را با کاربرانِ تخصیص‌یافته‌شان می‌خواند (تازه‌ترینِ ساخت اول).
 * هرگز credentialHash/enrollmentTokenHash را select نمی‌کند — فقط وجودِ اعتبارنامه را
 * به‌صورتِ بولینِ `enrolled` افشا می‌کند.
 */
export async function listFleetNodes(): Promise<FleetNodeRow[]> {
  const nodes = await db
    .select({
      id: workerNodes.id,
      nodeKey: workerNodes.nodeKey,
      region: workerNodes.region,
      health: workerNodes.health,
      capacity: workerNodes.capacity,
      agentVersion: workerNodes.agentVersion,
      ipAddress: workerNodes.ipAddress,
      credentialHash: workerNodes.credentialHash,
      lastHeartbeat: workerNodes.lastHeartbeat,
      lastSeenAt: workerNodes.lastSeenAt,
      createdAt: workerNodes.createdAt,
    })
    .from(workerNodes)
    .orderBy(desc(workerNodes.createdAt));

  if (nodes.length === 0) return [];

  // تخصیص‌های همه‌ی نودها + اطلاعاتِ کاربر را یک‌جا بخوان (join)، سپس به نود گروه کن.
  const nodeIds = nodes.map((n) => n.id);
  const assignmentRows = await db
    .select({
      nodeId: workerAssignments.nodeId,
      userId: users.id,
      email: users.email,
      name: users.name,
      fullName: users.fullName,
      plan: users.plan,
    })
    .from(workerAssignments)
    .innerJoin(users, eq(workerAssignments.userId, users.id))
    .where(inArray(workerAssignments.nodeId, nodeIds));

  const byNode = new Map<string, AssignedUserRow[]>();
  for (const r of assignmentRows) {
    const list = byNode.get(r.nodeId) ?? [];
    list.push({
      userId: r.userId,
      email: r.email,
      name: r.name,
      fullName: r.fullName,
      plan: r.plan,
    });
    byNode.set(r.nodeId, list);
  }

  return nodes.map((n) => ({
    id: n.id,
    nodeKey: n.nodeKey,
    region: n.region,
    health: n.health,
    capacity: n.capacity,
    agentVersion: n.agentVersion,
    ipAddress: n.ipAddress,
    enrolled: Boolean(n.credentialHash),
    lastHeartbeat: n.lastHeartbeat,
    lastSeenAt: n.lastSeenAt,
    createdAt: n.createdAt,
    assignedUsers: byNode.get(n.id) ?? [],
  }));
}

/** پلنِ خامِ یک کاربر را می‌خواند (برای اعمالِ سقفِ IP هنگامِ تخصیص). */
export async function readUserPlan(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.plan ?? null;
}
