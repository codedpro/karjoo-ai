import "server-only";

/**
 * POST /api/auth/otp/verify  { phone, code }
 *
 * کدِ ورود را راستی‌آزمایی می‌کند؛ در صورتِ موفقیت کاربر را (در صورتِ نبودن) می‌سازد،
 * یک نشستِ 'web' صادر می‌کند، کوکیِ امنِ httpOnly می‌نشاند و کاربر را برمی‌گرداند.
 *
 * در شکست، یک ۴۰۱ عمومی برمی‌گرداند (علتِ دقیق فاش نمی‌شود تا حدسِ هدفمند سخت شود).
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { WEB_SESSION_TTL_MS } from "@/lib/auth/core";
import {
  checkOtpRateLimit,
  clientIp,
  OTP_VERIFY_IP_MAX,
  OTP_VERIFY_PHONE_MAX,
  publicUser,
  setSessionCookie,
  verifyOtpAndLogin,
} from "@/lib/auth/http";
import { otpVerifySchema } from "@/lib/auth/schemas";

// به DB و node API (crypto/cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — کوکی می‌نشاند و به DB می‌نویسد.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) اعتبارسنجیِ ورودی.
    const { phone, code } = await parseJsonBody(request, otpVerifySchema);

    // ۱٫۵) محدودیتِ نرخِ سخت‌گیرانه: تلاشِ راستی‌آزمایی هم per-IP و هم per-phone
    //      (ضدِ brute-force روی کد، مکملِ سقفِ ۵-تلاشِ per-code در هسته). عبور → ۴۲۹.
    const now = Date.now();
    const ip = clientIp(request);
    if (
      !checkOtpRateLimit(`otp-vrf-ip:${ip}`, now, OTP_VERIFY_IP_MAX) ||
      !checkOtpRateLimit(`otp-vrf-phone:${phone}`, now, OTP_VERIFY_PHONE_MAX)
    ) {
      return errorJson("تلاش‌های بیش از حد. کمی بعد دوباره تلاش کنید.", 429);
    }

    // ۲) راستی‌آزمایی + ورود (هسته یک‌بارمصرفی/سقفِ تلاش را اعمال می‌کند).
    const userAgent = request.headers.get("user-agent");
    const outcome = await verifyOtpAndLogin(phone, code, { userAgent });

    if (!outcome.ok) {
      // پیامِ عمومی؛ علتِ دقیق (expired/mismatch/…) فقط برای منطقِ داخلی است.
      return errorJson("کد ورود نامعتبر یا منقضی شده است", 401);
    }

    // ۳) کوکیِ نشستِ امن را بنشان (توکنِ خام فقط همین‌جا در دسترس است).
    await setSessionCookie(outcome.session.token, WEB_SESSION_TTL_MS);

    // ۴) کاربر را با فیلدهای غیرحساس برگردان.
    return json({ ok: true, user: publicUser(outcome.user) });
  });
}
