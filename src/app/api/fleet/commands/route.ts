import "server-only";

/**
 * GET /api/fleet/commands
 *
 * فرمان‌های pendingِ نودِ کارگرِ احرازشده را برمی‌گرداند (Track A، قاعده‌ی ۴) تا نود
 * بداند چه فرمانِ 'update'/'restart'ی باید اجرا کند. قدیمی‌تر اول.
 *
 * احراز: اعتبارنامه‌ی نود (requireNodeCredential). نودِ هدف *همیشه* از اعتبارنامه می‌آید —
 * pollCommands فقط فرمان‌های همان nodeId را برمی‌گرداند، پس نشتِ cross-node ممکن نیست.
 *
 * پاسخ: { count, commands: [{ id, command, payload, issuedAt, status }] }
 */
import { json, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import { pollCommands } from "@/lib/fleet/commands";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ نود (۴۰۱ اگر اعتبارنامه نامعتبر).
    const node = await requireNodeCredential(request);

    // ۲) فرمان‌های pendingِ همین نود (قدیمی‌تر اول).
    const commands = await pollCommands(node.id);

    return json({
      count: commands.length,
      commands: commands.map((c) => ({
        id: c.id,
        command: c.command,
        payload: c.payload,
        issuedAt: c.issuedAt,
        status: c.status,
      })),
    });
  });
}
