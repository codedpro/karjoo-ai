import "server-only";

import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { extensionRunActionSchema } from "@/lib/api/extension-schemas";
import { getLiveApplyOverview } from "@/lib/apply/live-overview";
import {
  blockExtensionExecution,
  completeExtensionExecution,
  ExecutionOwnershipError,
  heartbeatExtensionExecution,
  pauseExtensionExecution,
  readExecutionRun,
  startExtensionExecution,
  updateExtensionProgress,
} from "@/lib/apply/execution-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function overview(userId: string) {
  const [run, live] = await Promise.all([
    readExecutionRun(userId),
    getLiveApplyOverview(userId, { queueLimit: 100, recentLimit: 100 }),
  ]);
  return { run, ...live };
}

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    return json(await overview(userId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const body = await parseJsonBody(request, extensionRunActionSchema);

    try {
      switch (body.action) {
        case "start":
        case "takeover":
          await startExtensionExecution(userId, body.executorId, {
            takeover: body.action === "takeover",
            backgroundEnabled: body.backgroundEnabled,
          });
          break;
        case "pause":
        case "stop":
          await pauseExtensionExecution(userId, body.executorId, {
            stop: body.action === "stop",
          });
          break;
        case "heartbeat":
          await heartbeatExtensionExecution(userId, body.executorId, {
            backgroundEnabled: body.backgroundEnabled,
          });
          break;
        case "progress":
          await updateExtensionProgress(userId, body.executorId, {
            currentTaskId: body.currentTaskId,
            progress: body.progress,
          });
          break;
        case "block":
          await blockExtensionExecution(
            userId,
            body.executorId,
            body.taskId,
            body.reason,
          );
          break;
        case "complete":
          await completeExtensionExecution(userId, body.executorId);
          break;
      }
    } catch (error) {
      if (error instanceof ExecutionOwnershipError) {
        return json({ error: error.message, code: error.code }, 409);
      }
      throw error;
    }

    return json(await overview(userId));
  });
}
