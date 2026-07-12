import "server-only";

/**
 * POST /api/wallet/topup — *بازنشسته* (۴۱۰ Gone).
 *
 * کارجو دیگر پول نمی‌گیرد: کیف‌پول همان کیف‌پولِ واحدِ 1xAi است و شارژ (زرین‌پال +
 * کارت‌به‌کارت) *فقط* در داشبوردِ 1xai انجام می‌شود — https://1xai.ir/topup.
 * جریانِ قدیمیِ کارت‌به‌کارت (درخواستِ pending + تأییدِ ادمین) حذف شده است.
 *
 * ترتیب عمدی است: اول احرازِ هویت (۴۰۱)، بعد ۴۱۰ — تا این مسیر برای ناشناس‌ها
 * probe‌پذیر نباشد و کلاینت‌های قدیمی همان رفتارِ گیتِ نشست را ببینند.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";

// به node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** نشانیِ یکتای شارژِ کیف‌پولِ واحد (خانواده‌ی 1xAi). */
const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

export async function POST(): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — ۴۰۱ قبل از ۴۱۰ (مسیر برای ناشناس‌ها بسته می‌ماند).
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) همیشه ۴۱۰ — شارژ فقط در داشبوردِ 1xai.
    return json(
      {
        error: "شارژ از داشبوردِ 1xai انجام می‌شود",
        topupUrl: ONEXAI_TOPUP_URL,
      },
      410,
    );
  });
}
