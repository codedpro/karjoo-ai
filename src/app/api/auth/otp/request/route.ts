import "server-only";

/**
 * POST /api/auth/otp/request  { phone }
 *
 * یک کدِ ورودِ یک‌بارمصرف برای شماره می‌سازد و پیامک می‌کند (در نبودِ providerِ پیامک،
 * در کنسول لاگ می‌شود — حالتِ توسعه). برای جلوگیری از اسپمِ پیامک، per-phone محدودِ نرخ
 * می‌شود.
 *
 * نکته‌ی امنیتی: پاسخ همیشه «عمومی و یکسان» است (چه شماره وجود داشته باشد چه نه) تا
 * نشت ندهد که کدام شماره ثبت‌نام کرده است (user enumeration).
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import {
  checkOtpRateLimit,
  clientIp,
  OTP_REQUEST_IP_MAX,
  requestOtp,
} from "@/lib/auth/http";
import { otpRequestSchema } from "@/lib/auth/schemas";

// به DB و node API (crypto) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی صدورِ OTP نباید بیفتد.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۰) محدودیتِ نرخِ سخت‌گیرانه بر اساسِ IP — یک آدرس نتواند برای چند شماره اسپم کند.
    const ip = clientIp(request);
    if (!checkOtpRateLimit(`otp-req-ip:${ip}`, Date.now(), OTP_REQUEST_IP_MAX)) {
      return errorJson("درخواست‌های بیش از حد از این آدرس. کمی بعد دوباره تلاش کنید.", 429);
    }

    // ۱) اعتبارسنجی + نرمالِ شماره (E.164).
    const { phone } = await parseJsonBody(request, otpRequestSchema);

    // ۲) محدودسازیِ نرخ per-phone. در صورتِ عبور، همان پاسخِ عمومی را می‌دهیم تا
    //    رفتارِ سرور قابلِ تمایز نباشد، ولی پیامکِ تازه نمی‌فرستیم.
    if (checkOtpRateLimit(phone)) {
      await requestOtp(phone);
    }

    // ۳) پاسخِ عمومیِ یکسان (هرگز فاش نکن که شماره موجود است یا کد ارسال شد).
    return json({ ok: true, message: "اگر شماره معتبر باشد، کد ورود ارسال شد." });
  });
}
