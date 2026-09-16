import "server-only";
/**
 * GET /api/auth/1xai/callback?ticket=…&next=… — «ورود با حسابِ 1xAi».
 *
 * 1xai.ir/sso/karjoo برای کاربرِ واردشده یک بلیتِ یک‌بارمصرف (۶۰ ثانیه) می‌سازد و مرورگر
 * را این‌جا می‌فرستد. بلیت سمتِ سرور و از راهِ /svc (امضای HMAC) مصرف می‌شود؛ پس بلیتِ
 * لورفته پس از اولین استفاده یا یک دقیقه بی‌اثر است. سپس همان نشستِ وبِ مسیرهای دیگرِ
 * ورود صادر می‌شود.
 *
 * `next` فقط مسیرِ نسبیِ داخلی است (safeNextPath) تا redirectِ باز ساخته نشود.
 */
import { issueSession, WEB_SESSION_TTL_MS } from "@/lib/auth/core";
import { findOrCreateUserByPool, setSessionCookie } from "@/lib/auth/http";
import { safeNextPath } from "@/lib/auth/safe-next";
import { logger } from "@/lib/observability/logger";
import { EVENTS, flush, identify, track } from "@/lib/analytics";
import { redeemPoolSsoTicket } from "@/lib/onexai/svc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(path: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const ticket = (searchParams.get("ticket") ?? "").trim();
  const next = safeNextPath(searchParams.get("next"));
  if (!ticket || ticket.length > 200) return redirect("/login?error=onexai");

  try {
    const pool = await redeemPoolSsoTicket(ticket);
    if (!pool) return redirect("/login?error=onexai");

    const user = await findOrCreateUserByPool(pool);
    if (user.isActive === false) return redirect("/login?error=onexai");

    const userAgent = request.headers.get("user-agent");
    const { token } = await issueSession(user.id, "web", { userAgent });
    await setSessionCookie(token, WEB_SESSION_TTL_MS);

    try {
      identify(user.id, { email: user.email ?? undefined, name: user.name ?? undefined });
      track(user.id, EVENTS.LOGIN, { method: "onexai" });
      await flush();
    } catch {
      /* آنالیتیکس هرگز مسیرِ ورود را نمی‌شکند. */
    }
    return redirect(next);
  } catch (err) {
    logger.warn("1xai sign-in failed", {
      path: "auth/1xai/callback",
      err: err instanceof Error ? err : new Error(String(err)),
    });
    return redirect("/login?error=onexai_unavailable");
  }
}
