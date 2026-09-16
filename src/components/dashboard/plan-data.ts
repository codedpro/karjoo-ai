import "server-only";

/**
 * خواندنِ «وضعیتِ اشتراکِ کاربر» برای داشبورد و مسیرِ `GET /api/me/plan` (server-side).
 *
 * کارجو پلنِ محلی ندارد: اشتراک و کیف‌پول هر دو در 1xai هستند. این لایه:
 *   • مزایای کاربر را از اشتراکِ 1xai می‌خواند (`readEntitlements`)،
 *   • موجودی را از کیف‌پولِ واحد می‌گیرد — چون فقط نمایشی است، در دسترس‌نبودنِ 1xai به ۰
 *     تنزل می‌کند (گیت‌های پولی جای دیگری هستند و هرگز موجودیِ مثبتِ جعلی نمی‌سازیم)،
 *   • و تعدادِ اپلای‌های امروز را نسبت به سهمیه می‌سنجد.
 *
 * هیچ debit/credit‌ای اینجا انجام نمی‌شود؛ صرفاً نمایش.
 */
import { countAppliesToday } from "@/lib/billing/apply-quota";
import { applyQuotaOf, type Entitlements } from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
import { getUnifiedBalance } from "@/lib/billing/unified";

/** وضعیتِ سهمیه‌ی اپلای امروزِ کاربر. */
export interface ApplyUsageStatus {
  /** سقفِ روزانه — null برای اشتراک‌های نامحدود. */
  limit: number | null;
  usedToday: number;
  /** باقی‌مانده — null اگر نامحدود. */
  remaining: number | null;
}

/** وضعیتِ کاملِ اشتراکِ کاربر — مصرفِ مشترکِ route و داشبورد. */
export interface UserPlanStatus {
  entitlements: Entitlements;
  balanceToman: number;
  apply: ApplyUsageStatus;
}

export async function getUserPlanStatus(userId: string): Promise<UserPlanStatus> {
  const entitlements = await readEntitlements(userId);
  const limit = applyQuotaOf(entitlements);

  const [balanceToman, usedToday] = await Promise.all([
    getUnifiedBalance(userId)
      .then((b) => b.availableToman)
      .catch(() => 0),
    limit === null ? Promise.resolve(0) : countAppliesToday(userId),
  ]);

  return {
    entitlements,
    balanceToman,
    apply: {
      limit,
      usedToday: limit === null ? 0 : usedToday,
      remaining: limit === null ? null : Math.max(0, limit - usedToday),
    },
  };
}
