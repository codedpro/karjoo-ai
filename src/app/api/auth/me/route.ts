import "server-only";

/**
 * GET /api/auth/me
 *
 * کاربرِ احرازشده‌ی جاری را (از کوکیِ نشست) برمی‌گرداند. در نبودِ نشستِ معتبر، ۴۰۱.
 * فقط فیلدهای غیرحساسِ کاربر برگردانده می‌شوند (هیچ توکن/نشست/کلید).
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser, publicUser } from "@/lib/auth/http";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }
    return json({ user: publicUser(user) });
  });
}
