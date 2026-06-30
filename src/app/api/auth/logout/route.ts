import "server-only";

/**
 * POST /api/auth/logout
 *
 * نشستِ جاری (از کوکی) را سمتِ سرور باطل می‌کند و کوکی را پاک می‌کند. idempotent —
 * حتی بدونِ نشستِ معتبر هم با موفقیتِ ۲۰۰ پاسخ می‌دهد (کوکی در هر حال پاک می‌شود).
 */
import { json, withErrorHandling } from "@/lib/api/http";
import { clearSessionCookie, logoutByToken, readSessionToken } from "@/lib/auth/http";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) توکنِ نشست را از کوکی بخوان و سمتِ سرور باطلش کن (best-effort/idempotent).
    const token = await readSessionToken();
    await logoutByToken(token);

    // ۲) کوکی را پاک کن (حتی اگر نشست از پیش باطل/ناموجود بود).
    await clearSessionCookie();

    return json({ ok: true });
  });
}
