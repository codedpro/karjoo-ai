import "server-only";

/**
 * GET  /api/ai-settings — مدلِ انتخابیِ کاربرِ احرازشده (یا پیش‌فرضِ recommended).
 * PUT  /api/ai-settings — تنظیمِ مدلِ کاربر (بدنه: { modelId }).
 *
 * امنیت (§10 — تنظیماتِ هر کاربر فقط برای همان کاربر): کاربرِ هدف از کوکیِ نشستِ وب
 * گرفته می‌شود (getCurrentUser)، نه از بدنه/کوئری؛ بدنه عمداً userId/provider نمی‌پذیرد.
 * provider از خودِ کاتالوگ مشتق می‌شود. فقط مدلی پذیرفته می‌شود که در کاتالوگ موجود و
 * enabled باشد — در غیرِ این صورت ۴۲۲ (مدل ناشناخته/غیرفعال)، تا هرگز یک modelIdِ
 * بی‌قیمت ذخیره نشود (که فراخوانیِ بعدیِ پولی را می‌شکست).
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { updateAiSettingsBodySchema } from "@/lib/ai-settings/schemas";
import { getUserModelSelection, setUserModel } from "@/lib/ai-settings/store";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const selection = await getUserModelSelection(user.id);
    if (!selection) {
      // کاتالوگ خالی است (هنوز seed/sync نشده) → چیزی برای انتخاب نیست.
      return json({ provider: null, modelId: null, isDefault: true });
    }
    return json({
      provider: selection.provider,
      modelId: selection.modelId,
      isDefault: selection.isDefault,
    });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const { modelId } = await parseJsonBody(request, updateAiSettingsBodySchema);
    const result = await setUserModel(user.id, modelId);

    if (!result.ok) {
      // مدل در کاتالوگ نیست/غیرفعال است → ۴۲۲ (بدنه نحوی درست بود، ولی معنا نامعتبر).
      return errorJson("مدلِ انتخابی یافت نشد یا غیرفعال است", 422);
    }

    return json({
      provider: result.selection.provider,
      modelId: result.selection.modelId,
      isDefault: false,
    });
  });
}
