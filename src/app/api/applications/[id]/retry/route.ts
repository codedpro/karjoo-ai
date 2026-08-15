import "server-only";

import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { retryFailedApplication } from "@/lib/apply/interview-prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const { id } = await params;
    const result = await retryFailedApplication(user.id, id);
    if (!result.ok) {
      const message =
        result.reason === "gender_mismatch"
          ? "این آگهی با جنسیت پروفایل سازگار نیست و دوباره صف نمی‌شود."
          : result.reason === "no_task"
            ? "برای این اپلای task قابل retry پیدا نشد."
            : "اپلای ناموفق پیدا نشد.";
      return errorJson(message, result.reason === "not_found" ? 404 : 409, {
        reason: result.reason,
      });
    }

    return json({ ok: true, taskId: result.taskId });
  });
}
