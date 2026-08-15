"use server";

/**
 * اکشن‌های سرورِ بخشِ ادمینِ ناوگان (server actions) — Track C.
 *
 * این‌ها «پروکسیِ امن» به هسته‌ی Foundationِ ناوگان‌اند: روی کنترل‌پلین اجرا می‌شوند، با
 * نگهبانِ ادمین (isDashboardAdmin — مقایسه‌ی رازِ داخلیِ سرور سمتِ سرور) محافظت می‌شوند، و راز
 * *هرگز* به کلاینت نشت نمی‌کند. کلاینت فقط شناسه‌ها (nodeId/userId) را می‌فرستد؛ مجوز از
 * کوکیِ ادمین می‌آید، نه از بدنه.
 *
 * هر اکشن:
 *   ۱) نگهبانِ ادمین را اجرا می‌کند (در صورت رد → خروجیِ خطا، هیچ تغییری).
 *   ۲) ورودی را اعتبارسنجی می‌کند (UUID).
 *   ۳) هسته‌ی Foundation را صدا می‌زند (assignNodeToUser/unassignNodeFromUser/issueCommand).
 *   ۴) صفحه‌ی ادمین را revalidate می‌کند تا فهرست تازه شود.
 *
 * خروجی همیشه { ok, message } است (هرگز throw به UI نمی‌دهد تا فرم‌ها تمیز بمانند).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assignNodeToUser, unassignNodeFromUser, WorkerIpLimitError } from "@/lib/fleet/assign";
import { issueCommand } from "@/lib/fleet/commands";
import type { Plan, WorkerCommand } from "@/db/schema";
import { isDashboardAdmin } from "./admin-guard";
import { readUserPlan } from "./fleet-admin-data";

/** مسیرِ صفحه‌ی ادمینِ ناوگان — برای revalidate پس از هر تغییر. */
const ADMIN_FLEET_PATH = "/dashboard/fleet";

/** نتیجه‌ی یکدستِ هر اکشنِ ادمین. */
export interface FleetActionResult {
  ok: boolean;
  message: string;
}

const uuid = z.string().uuid();
const assignSchema = z.object({ nodeId: uuid, userId: uuid });
const commandSchema = z.object({
  nodeId: uuid,
  command: z.enum(["update", "restart"]),
});

/** نگهبانِ مشترک: اگر ادمین نباشد، نتیجه‌ی ردِ یکدست برمی‌گرداند (هیچ تغییری). */
async function requireAdmin(): Promise<FleetActionResult | null> {
  const ok = await isDashboardAdmin();
  if (!ok) {
    return { ok: false, message: "دسترسیِ ادمین ندارید." };
  }
  return null;
}

/**
 * یک نود را به یک کاربر تخصیص می‌دهد (سقفِ IPِ پلن توسطِ Foundation اعمال می‌شود).
 * پلنِ کاربر سمتِ سرور خوانده می‌شود (نه از کلاینت) تا سقف درست اعمال شود.
 */
export async function assignNodeAction(
  nodeId: string,
  userId: string,
): Promise<FleetActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = assignSchema.safeParse({ nodeId, userId });
  if (!parsed.success) {
    return { ok: false, message: "شناسه‌ی نود یا کاربر نامعتبر است." };
  }

  const plan = await readUserPlan(parsed.data.userId);
  if (plan === null) {
    return { ok: false, message: "کاربر یافت نشد." };
  }

  try {
    await assignNodeToUser(parsed.data.userId, parsed.data.nodeId, plan as Plan);
    revalidatePath(ADMIN_FLEET_PATH);
    return { ok: true, message: "نود با موفقیت به کاربر تخصیص یافت." };
  } catch (err) {
    if (err instanceof WorkerIpLimitError) {
      return { ok: false, message: err.message };
    }
    console.error("[fleet-admin] assign failed:", err);
    return { ok: false, message: "تخصیصِ نود ناموفق بود." };
  }
}

/** تخصیصِ یک نود از یک کاربر را حذف می‌کند (idempotent). */
export async function unassignNodeAction(
  nodeId: string,
  userId: string,
): Promise<FleetActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = assignSchema.safeParse({ nodeId, userId });
  if (!parsed.success) {
    return { ok: false, message: "شناسه‌ی نود یا کاربر نامعتبر است." };
  }

  try {
    const removed = await unassignNodeFromUser(parsed.data.userId, parsed.data.nodeId);
    revalidatePath(ADMIN_FLEET_PATH);
    return {
      ok: true,
      message: removed ? "تخصیصِ نود حذف شد." : "تخصیصی برای حذف یافت نشد.",
    };
  } catch (err) {
    console.error("[fleet-admin] unassign failed:", err);
    return { ok: false, message: "حذفِ تخصیص ناموفق بود." };
  }
}

/**
 * یک فرمانِ 'update' یا 'restart' برای یک نود صادر می‌کند. روی 'update'، Foundation خودش
 * مسیرِ اسکریپتِ به‌روزرسانی (fleetUpdateScript) را در payload می‌گذارد — این‌جا چیزی
 * اجرا نمی‌شود، فقط فرمان صادر می‌شود.
 */
export async function issueCommandAction(
  nodeId: string,
  command: WorkerCommand,
): Promise<FleetActionResult> {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = commandSchema.safeParse({ nodeId, command });
  if (!parsed.success) {
    return { ok: false, message: "شناسه‌ی نود یا نوعِ فرمان نامعتبر است." };
  }

  try {
    await issueCommand(parsed.data.nodeId, parsed.data.command);
    revalidatePath(ADMIN_FLEET_PATH);
    const label = parsed.data.command === "update" ? "به‌روزرسانی" : "ری‌استارت";
    return { ok: true, message: `فرمانِ ${label} برای نود صادر شد.` };
  } catch (err) {
    console.error("[fleet-admin] issueCommand failed:", err);
    return { ok: false, message: "صدورِ فرمان ناموفق بود." };
  }
}
