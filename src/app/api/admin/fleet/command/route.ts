import "server-only";

/**
 * POST /api/admin/fleet/command
 *
 * یک فرمانِ 'update'/'restart' برای یک نودِ کارگر صادر می‌کند (Track A، قاعده‌ی ۴ —
 * به‌روزرسانیِ فرمان‌محورِ سرور). نود بعداً با GET /api/fleet/commands آن را poll و با
 * /ack اجرا/تأیید می‌کند. برای 'update'، هسته به‌صورتِ advisory مسیرِ اسکریپتِ
 * به‌روزرسانی (fleetUpdateScript) را در payload می‌گذارد اگر داده نشده باشد.
 *
 * با رازِ مشترکِ داخلی محافظت می‌شود (X-Internal-Secret؛ fail-closed → ۵۰۳).
 *
 * بدنه (JSON): { nodeId, command: 'update'|'restart', payload? }
 */
import { eq } from "drizzle-orm";

import { guardInternal, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { adminCommandBodySchema } from "@/lib/api/fleet-schemas";
import { issueCommand } from "@/lib/fleet/commands";
import { db } from "@/db";
import { workerNodes } from "@/db/schema";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ داخلی (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) اعتبارسنجیِ بدنه (strict).
    const body = await parseJsonBody(request, adminCommandBodySchema);

    // ۳) نودِ هدف باید موجود باشد (وگرنه FK خطا می‌دهد).
    const [nodeRow] = await db
      .select({ id: workerNodes.id })
      .from(workerNodes)
      .where(eq(workerNodes.id, body.nodeId))
      .limit(1);
    if (!nodeRow) {
      return json({ error: "node not found" }, 404);
    }

    // ۴) صدورِ فرمان (status='pending'). payload اختیاری؛ برای 'update' هسته اسکریپت را می‌گذارد.
    const command = await issueCommand(
      body.nodeId,
      body.command,
      body.payload !== undefined ? { payload: body.payload } : {},
    );

    return json({ command }, 201);
  });
}
