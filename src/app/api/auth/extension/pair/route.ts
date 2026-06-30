import "server-only";

/**
 * POST /api/auth/extension/pair  (نیازمندِ نشستِ وبِ معتبر)
 *
 * یک کدِ جفت‌سازیِ یک‌بارمصرفِ کوتاه‌عمر برای کاربرِ احرازشده‌ی جاری می‌سازد. افزونه با
 * این کد (از طریقِ مسیرِ redeem تیمِ افزونه) یک نشستِ 'extension' می‌گیرد — «بدون OTP
 * دوم» (قاعده‌ی ۵ بخش CONTEXT). فقط کدِ خام و زمانِ انقضا برگردانده می‌شود؛ هرگز رازِ
 * دیگری. فقط هشِ کد در DB می‌نشیند.
 *
 * نکته‌ی مالکیت: این مسیر زیرِ /api/auth است تا با /api/extension/* (تیمِ A3) تداخل نکند.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { createPairingCode } from "@/lib/auth/pairing";

// به DB و node API (crypto/cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) فقط کاربرِ احرازشده می‌تواند کدِ جفت‌سازی بسازد.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) کدِ یک‌بارمصرف بساز (هسته فقط هشش را ذخیره می‌کند).
    const { code, link } = await createPairingCode(user.id);

    // ۳) کدِ خام + انقضا را برگردان (این تنها فرصتِ دیدنِ کدِ خام است).
    return json({ ok: true, pairingCode: code, expiresAt: link.expiresAt.toISOString() });
  });
}
