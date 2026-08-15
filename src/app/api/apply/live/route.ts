import "server-only";

import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { getLiveApplyOverview } from "@/lib/apply/live-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const url = new URL(request.url);
    const queueLimitRaw = Number(url.searchParams.get("queueLimit") ?? "40");
    const recentLimitRaw = Number(url.searchParams.get("recentLimit") ?? "30");

    const overview = await getLiveApplyOverview(user.id, {
      queueLimit: Number.isFinite(queueLimitRaw) ? queueLimitRaw : 40,
      recentLimit: Number.isFinite(recentLimitRaw) ? recentLimitRaw : 30,
    });

    return json(overview);
  });
}
