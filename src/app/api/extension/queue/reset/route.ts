import "server-only";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { extensionQueueResetBodySchema } from "@/lib/api/extension-schemas";
import { resetExtensionQueue } from "@/lib/apply/extension-queue-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = await parseJsonBody(request, extensionQueueResetBodySchema);
    return json({ ok: true, ...(await resetExtensionQueue(userId, body.executorId)) });
  });
}
