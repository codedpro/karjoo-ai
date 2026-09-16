import "server-only";

/**
 * اشتراکِ کاربرِ احرازشده:
 *   • GET  /api/me/plan — اشتراکِ 1xai + مزایای کارجو + اپلای امروز/سهمیه + موجودی.
 *   • POST /api/me/plan — دیگر وجود ندارد (۴۱۰). کارجو پلنِ جداگانه نمی‌فروشد؛ خرید و
 *     تغییرِ اشتراک فقط در 1xai.ir انجام می‌شود و همان اشتراک مزایای کارجو را هم می‌دهد.
 *
 * امنیت: کاربر همیشه از کوکیِ نشست یا Bearerِ افزونه می‌آید، نه از بدنه/کوئری.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import {
  ONEXAI_PLAN_URL,
  ONEXAI_TOPUP_URL,
  type Entitlements,
} from "@/lib/billing/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ردهٔ قدیمیِ پلن که افزونه‌های منتشرشده هنوز می‌خوانند (فقط برای اینکه بدانند نشست را به
 * خزانه بفرستند یا نه: max/maxplus). از مزایای اشتراکِ 1xai ساخته می‌شود.
 */
function legacyTier(e: Entitlements): "free" | "pro" | "max" | "maxplus" {
  if (e.workerIpLimit >= 5) return "maxplus";
  if (e.workerIpLimit > 0) return "max";
  return e.unlimitedApplies ? "pro" : "free";
}

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    const status = await getUserPlanStatus(user.id);
    const e = status.entitlements;

    return json({
      plan: legacyTier(e),
      subscription: {
        planKey: e.planKey,
        planNameFa: e.planNameFa,
        status: e.status,
        periodEnd: e.periodEnd?.toISOString() ?? null,
        unlimitedApplies: e.unlimitedApplies,
        workerIpLimit: e.workerIpLimit,
        unavailable: e.unavailable ?? false,
        manageUrl: ONEXAI_PLAN_URL,
      },
      balanceToman: status.balanceToman,
      topupUrl: ONEXAI_TOPUP_URL,
      apply: status.apply,
    });
  });
}

export async function POST(): Promise<Response> {
  return errorJson(
    "اشتراکِ کارجو و 1xAi یکی است؛ خرید و تغییرِ اشتراک فقط در 1xai.ir انجام می‌شود.",
    410,
    { manageUrl: ONEXAI_PLAN_URL },
  );
}
