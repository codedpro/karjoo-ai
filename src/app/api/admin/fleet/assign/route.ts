import "server-only";

/**
 * POST /api/admin/fleet/assign
 *
 * یک نودِ ورکر را به یک کاربر تخصیص می‌دهد (Track A، قاعده‌ی ۲ — سقفِ IP بر اساسِ پلن).
 * با رازِ مشترکِ داخلی محافظت می‌شود (X-Internal-Secret؛ fail-closed → ۵۰۳).
 *
 * سقفِ ورکر در هسته‌ی assignNodeToUser اعمال می‌شود (از اشتراکِ 1xai).
 * مزایای کاربر را اینجا از 1xai می‌خوانیم و به هسته می‌دهیم. اگر کاربر نباشد → ۴۰۴؛ اگر سقف
 * پر/پلن بی‌ورکر باشد → WorkerIpLimitError → ۴۰۹ (با limit/assigned برای UI).
 *
 * بدنه (JSON): { userId, nodeId }
 */
import { eq } from "drizzle-orm";

import { guardInternal, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { adminAssignBodySchema } from "@/lib/api/fleet-schemas";
import { readEntitlements } from "@/lib/billing/subscription";
import { assignNodeToUser, WorkerIpLimitError } from "@/lib/fleet/assign";
import { db } from "@/db";
import { users, workerNodes } from "@/db/schema";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ داخلی (fail-closed).
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) اعتبارسنجیِ بدنه (strict).
    const body = await parseJsonBody(request, adminAssignBodySchema);

    // ۳) کاربرِ هدف باید موجود باشد (سقف از اشتراکِ 1xai). کاربرِ ناموجود → ۴۰۴.
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!user) {
      return json({ error: "user not found" }, 404);
    }

    // ۳٫۵) نودِ هدف باید موجود باشد (وگرنه FK خطا می‌دهد؛ پیامِ تمیزتر می‌دهیم).
    const [nodeRow] = await db
      .select({ id: workerNodes.id })
      .from(workerNodes)
      .where(eq(workerNodes.id, body.nodeId))
      .limit(1);
    if (!nodeRow) {
      return json({ error: "node not found" }, 404);
    }

    // ۴) تخصیص — سقفِ IPِ پلن داخلِ هسته اعمال می‌شود (اتمیک، داخلِ تراکنش).
    try {
      const assignment = await assignNodeToUser(
        body.userId,
        body.nodeId,
        await readEntitlements(body.userId, { fresh: true }),
      );
      return json({ assignment }, 201);
    } catch (err) {
      if (err instanceof WorkerIpLimitError) {
        // پلنِ بی‌ورکر یا سقفِ پر → ۴۰۹ (تضادِ ظرفیت) با اعدادِ دقیق برای UI.
        return json(
          {
            error: err.message,
            code: err.code,
            limit: err.limit,
            assigned: err.assigned,
          },
          409,
        );
      }
      throw err;
    }
  });
}
