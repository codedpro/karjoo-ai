import "server-only";

import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { resumeSettingsSaveSchema } from "@/lib/resume/api-schemas";
import { readResumeSettings, writeResumeSettings } from "@/lib/resume/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    return json({ settings: await readResumeSettings(user.id) });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);
    const body = await parseJsonBody(request, resumeSettingsSaveSchema);
    const settings = await writeResumeSettings(user.id, body, {
      fallbackFullName: user.fullName ?? user.name ?? undefined,
    });
    return json({ settings });
  });
}
