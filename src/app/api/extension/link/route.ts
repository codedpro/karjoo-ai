import "server-only";

/**
 * POST /api/extension/link
 *
 * هندآفِ «بدون OTP دوم» (CONTEXT، قاعده‌ی ۵): افزونه یک کدِ جفت‌سازیِ یک‌بارمصرف را
 * که در وب ساخته شده redeem می‌کند → یک نشستِ 'extension' صادر می‌شود و توکنِ خامش
 * **در بدنه‌ی پاسخ** برگردانده می‌شود (نه کوکی) تا افزونه آن را ذخیره کند و در
 * مسیرهای بعدی به‌صورت `Authorization: Bearer <token>` بفرستد.
 *
 * هیچ phone-OTP دومی لازم نیست؛ هویت از همان حسابِ وبِ از-پیش-احرازشده می‌آید.
 * کدِ جفت‌سازی یک‌بارمصرف و کوتاه‌عمر است؛ redeemِ نامعتبر/منقضی/مصرف‌شده → ۴۰۱.
 *
 * بدنه (JSON): { pairingCode: string }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { extensionLinkBodySchema } from "@/lib/api/extension-schemas";
import { redeemPairingCode } from "@/lib/auth/pairing";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// تریگرِ نوشتنی — هرگز کش نشود.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) اعتبارسنجیِ بدنه.
    const body = await parseJsonBody(request, extensionLinkBodySchema);

    // ۲) redeem کن (یک‌بارمصرف، race-safe). userAgent برای متادیتای نشست.
    const userAgent = request.headers.get("user-agent");
    const redeemed = await redeemPairingCode(body.pairingCode, { userAgent });

    // ۳) fail-closed: کدِ نامعتبر/منقضی/مصرف‌شده → ۴۰۱ (بدون افشای علت).
    if (!redeemed) {
      return json({ error: "invalid or expired pairing code" }, 401);
    }

    // ۴) توکنِ خام فقط همین‌جا و یک‌بار به افزونه داده می‌شود (در DB نیست).
    return json(
      {
        token: redeemed.session.token,
        kind: redeemed.session.sessionRow.kind,
        userId: redeemed.session.sessionRow.userId,
        expiresAt: redeemed.session.sessionRow.expiresAt,
      },
      201,
    );
  });
}
