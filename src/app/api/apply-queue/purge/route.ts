import "server-only";

/**
 * GET    /api/apply-queue/purge — چند آگهی از هر سایت در نوبت است.
 * DELETE /api/apply-queue/purge — نوبتِ این کاربر را خالی می‌کند (اختیاری: یک سایت).
 *
 * فقط نشستِ وبِ خودِ کاربر. ردیف‌های `pending` حذف می‌شوند و بس: کارِ در جریان و کلِ
 * تاریخچه‌ی ارسال‌ها دست‌نخورده می‌ماند، پس این کار برگشت‌پذیر است — کشفِ بعدی صف را
 * با فیلترهای فعلی دوباره پر می‌کند.
 */
import { z } from "zod";

import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { countPendingByBoard, pursePendingQueue } from "@/lib/apply/queue-purge";
import type { ActiveApplyBoard } from "@/lib/apply/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  board: z.enum(["jobinja", "jobvision", "e-estekhdam", "irantalent"]).optional(),
}).strict();

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    return json({ counts: await countPendingByBoard(user.id) });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    const body = await parseJsonBody(request, bodySchema);
    const removed = await pursePendingQueue(
      user.id,
      (body.board as ActiveApplyBoard | undefined) ?? null,
    );
    return json({ ok: true, removed, counts: await countPendingByBoard(user.id) });
  });
}
