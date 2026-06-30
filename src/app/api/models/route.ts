import "server-only";

/**
 * GET /api/models — کاتالوگِ مدل‌های فعالِ هوش مصنوعی، گروه‌بندی‌شده بر اساسِ provider.
 *
 * هر مدل: displayName، برچسب‌ها (recommended/premium/cheap/fast/persian)، قیمتِ
 * ورودی/خروجی به‌ازای هر ۱۰۰۰ توکن (تومان) و پنجره‌ی متن. این داده عمومیِ-درون‌برنامه‌ای
 * است (قیمت/قابلیت)؛ راز یا داده‌ی کاربری ندارد. با این حال نشست لازم است تا فقط
 * کاربرانِ واردشده آن را ببینند (سطحِ «public-ish to logged-in users»).
 *
 * علاوه بر کاتالوگ، انتخابِ فعلیِ مدلِ همین کاربر (selectedModelId) و modelId پیش‌فرضِ
 * recommended هم برگردانده می‌شود تا UI بتواند انتخاب/هایلایت را بدونِ round-trip دوم
 * نشان دهد. انتخاب همیشه به نشستِ همین کاربر مقید است (§10).
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import {
  getEnabledCatalog,
  getUserModelSelection,
  groupByProvider,
  recommendedModelId,
} from "@/lib/ai-settings/store";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // کاتالوگ + انتخابِ همین کاربر را موازی بخوان.
    const [catalog, selection] = await Promise.all([
      getEnabledCatalog(),
      getUserModelSelection(user.id),
    ]);

    return json({
      count: catalog.length,
      groups: groupByProvider(catalog),
      recommendedModelId: recommendedModelId(catalog),
      // انتخابِ فعلیِ کاربر (مدلِ صریح یا پیش‌فرضِ recommended).
      selectedModelId: selection?.modelId ?? null,
      isDefaultSelection: selection?.isDefault ?? true,
    });
  });
}
