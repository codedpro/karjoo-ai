import "server-only";

/**
 * POST /api/fleet/heartbeat
 *
 * heartbeatِ یک نودِ ورکرِ احرازشده را ثبت می‌کند (Track A، قاعده‌ی ۱) و خلاصه‌ای از
 * فرمان‌های pendingِ آن نود را برمی‌گرداند تا نود بداند کاری برای poll دارد یا نه.
 *
 * احراز: اعتبارنامه‌ی نود در هدرِ Authorization (requireNodeCredential). نودِ هدف *همیشه*
 * از اعتبارنامه می‌آید، نه از بدنه — هیچ nodeId در بدنه نیست (قاعده‌ی امنیت).
 *
 * بدنه (JSON، اختیاری): { health?, agentVersion?, ipAddress? }
 * پاسخ: { node, pendingCommands: { count, commands: [{ id, command }] } }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import { fleetHeartbeatBodySchema } from "@/lib/api/fleet-schemas";
import { recordHeartbeat } from "@/lib/fleet/enroll";
import { pollCommands } from "@/lib/fleet/commands";
import { publicNode } from "@/lib/api/fleet-node-view";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ نود (۴۰۱ اگر اعتبارنامه نامعتبر).
    const node = await requireNodeCredential(request);

    // ۲) بدنه‌ی اختیاری (health/agentVersion/ipAddress). بدنه‌ی خالی هم مجاز است.
    const body = await parseOptionalBody(request);

    // ۳) ثبتِ heartbeat — همیشه با node.id احرازشده.
    const updated = await recordHeartbeat(node.id, {
      ...(body.health !== undefined ? { health: body.health } : {}),
      ...(body.agentVersion !== undefined ? { agentVersion: body.agentVersion } : {}),
      ...(body.ipAddress !== undefined ? { ipAddress: body.ipAddress } : {}),
    });

    // ۴) خلاصه‌ی فرمان‌های pending (فقط id+command — جزئیات با GET /commands).
    const pending = await pollCommands(node.id);

    return json({
      node: publicNode(updated ?? node),
      pendingCommands: {
        count: pending.length,
        commands: pending.map((c) => ({ id: c.id, command: c.command })),
      },
    });
  });
}

/**
 * بدنه‌ی heartbeat را امن می‌خواند: بدنه‌ی خالی → پیش‌فرضِ خالی؛ بدنه‌ی موجودِ نامعتبر → ۴۰۰.
 */
async function parseOptionalBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    return fleetHeartbeatBodySchema.parse({});
  }
  const fakeRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  return parseJsonBody(fakeRequest, fleetHeartbeatBodySchema);
}
