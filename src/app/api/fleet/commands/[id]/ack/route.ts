import "server-only";

/**
 * POST /api/fleet/commands/:id/ack
 *
 * نودِ ورکرِ احرازشده وضعیتِ یک فرمان را به‌روزرسانی می‌کند (Track A، قاعده‌ی ۴):
 *   • 'acked'  → نود فرمان را برداشت و اجرا را شروع کرد.
 *   • 'done'/'failed' → اجرا تمام شد (با result اختیاری: stdout/exitCode/error).
 *
 * احراز: اعتبارنامه‌ی نود (requireNodeCredential). دفاعِ مالکیت: پیش از ack، تأیید می‌کنیم
 * که این فرمان به همین نودِ احرازشده تعلق دارد (id + nodeId) — وگرنه ۴۰۴ و *هیچ* تغییری.
 * این جلوی ackِ فرمانِ نودِ دیگر را می‌گیرد (ackCommandِ هسته خودش روی id یکتاست ولی
 * مالکیت را نمی‌سنجد؛ این چکِ سطحِ مسیر طبقِ یادداشتِ Foundation لازم است).
 *
 * بدنه (JSON): { status: 'acked'|'done'|'failed', result? }
 */
import { eq, and } from "drizzle-orm";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import {
  commandIdParamSchema,
  fleetCommandAckBodySchema,
} from "@/lib/api/fleet-schemas";
import { ackCommand } from "@/lib/fleet/commands";
import { db } from "@/db";
import { workerCommands } from "@/db/schema";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ نود (۴۰۱ اگر اعتبارنامه نامعتبر).
    const node = await requireNodeCredential(request);

    // ۲) اعتبارسنجیِ پارامترِ مسیر (params در Next 16 async است → await).
    const { id } = commandIdParamSchema.parse(await params);

    // ۳) اعتبارسنجیِ بدنه.
    const body = await parseJsonBody(request, fleetCommandAckBodySchema);

    // ۴) دفاعِ مالکیت: فرمان باید متعلق به همین نودِ احرازشده باشد.
    const [owned] = await db
      .select({ id: workerCommands.id })
      .from(workerCommands)
      .where(and(eq(workerCommands.id, id), eq(workerCommands.nodeId, node.id)))
      .limit(1);
    if (!owned) {
      return json({ error: "command not found" }, 404);
    }

    // ۵) ack — وضعیت/result را ثبت می‌کند.
    const updated = await ackCommand(id, body.status, body.result);
    if (!updated) {
      return json({ error: "command not found" }, 404);
    }

    return json({ command: updated });
  });
}
