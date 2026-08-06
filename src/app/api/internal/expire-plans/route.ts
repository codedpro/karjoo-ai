import "server-only";

/**
 * POST /api/internal/expire-plans — کارِ روزانه‌ی انقضای پلن (internal-only).
 *
 * پلن‌های پولی که دوره‌شان (به‌علاوه‌ی مهلتِ ارفاق) تمام شده را به `free` برمی‌گرداند.
 * بدونِ این، هر خرید یک اشتراکِ مادام‌العمر بود — پلن‌ها ماهانه قیمت‌گذاری می‌شوند ولی
 * هیچ انقضایی نداشتند (نشتِ مستقیمِ درآمد).
 *
 * ایمنی: `guardInternal` (رازِ مشترک) — از اینترنت قابلِ فراخوانی نیست. هیچ پولی
 * جابه‌جا نمی‌شود؛ فقط استحقاق با واقعیت هم‌تراز می‌شود. ایدمپوتنت است، پس تکرارِ
 * اجرا بی‌خطر است.
 */
import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { expireLapsedPlans } from "@/lib/billing/plan-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    const result = await expireLapsedPlans();
    return json({ downgraded: result.downgraded, userIds: result.userIds }, 200);
  });
}
