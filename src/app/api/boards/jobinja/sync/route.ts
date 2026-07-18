import "server-only";

/**
 * POST /api/boards/jobinja/sync  (وب، کوکیِ کاربر)
 *
 * fallbackِ سمتِ سرور: با نشستِ vaultِ کاربر، /jobs/applied و /app/cv-builder را می‌گیرد،
 * پارس و ذخیره می‌کند. برای دکمه‌ی «به‌روزرسانی» در داشبورد وقتی افزونه push نکرده.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { syncJobinjaFromVault } from "@/lib/apply/boards/jobinja-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("برای همگام‌سازی وارد شوید.", 401);

    const result = await syncJobinjaFromVault(user.id);
    if (!result.ok && result.reason === "no_session") {
      return errorJson("نشستِ جابینجا متصل نیست — از افزونه وصل کنید تا داده‌ها همگام شوند.", 409);
    }
    return json(result, 200);
  });
}
