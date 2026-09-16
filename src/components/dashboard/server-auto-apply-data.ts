import "server-only";

/**
 * خواندنِ داده‌ی کارتِ «اپلای خودکارِ سرور» برای صفحه‌ی اپلای خودکار (Track B، الگوی RSC).
 *
 * فقط-خواندنی و مقید به userId (قاعده‌ی ۴). «مصرف‌کننده» است و چیزی نمی‌نویسد:
 *   • قابلیتِ سرورِ اپلایِ پلنِ کاربر (آیا ورکر دارد + سقفِ IP) را از fleet-labels می‌گیرد،
 *   • تنظیماتِ مؤثرِ تاگلِ *سرور* (enabled/minScore) را از هسته‌ی Foundation
 *     (getServerAutoApplySettings، جدولِ user_server_auto_apply) می‌خواند.
 *
 * برای پلن‌های بدونِ ورکر (بدونِ ورکر) اصلاً تنظیماتِ سرور را کوئری نمی‌کنیم (مسیرِ ارزان):
 * آن‌ها واجدِ شرایط نیستند و کارتِ ارتقا می‌بینند، نه تاگل.
 */
import { cache } from "react";

import { getServerAutoApplySettings, type AutoApplySettings } from "@/lib/apply/auto-apply";
import { readEntitlements } from "@/lib/billing/subscription";
import {
  planFleetCapability,
  type PlanFleetCapability,
} from "@/components/dashboard/fleet-labels";

/** بسته‌ی داده‌ی کارتِ کنترلِ اپلای خودکارِ سرور. */
export interface ServerAutoApplyCardData {
  /** قابلیتِ سرورِ اپلایِ پلنِ کاربر (آیا واجدِ شرایط است + سقفِ IP + برچسبِ پلن). */
  capability: PlanFleetCapability;
  /** تنظیماتِ مؤثرِ تاگلِ سرور — فقط برای پلن‌های واجدِ شرایط معنا دارد. */
  settings: AutoApplySettings;
}

/**
 * داده‌ی کارتِ کنترلِ اپلای خودکارِ سرور را می‌سازد. مقید به userId (قاعده‌ی ۴). چیزی نمی‌نویسد.
 * پلن‌های بی‌ورکر تنظیماتِ سرور را کوئری نمی‌کنند (پیش‌فرضِ خاموش کافی است).
 */
export const getServerAutoApplyCardData = cache(
  async (userId: string): Promise<ServerAutoApplyCardData> => {
    const capability = planFleetCapability(await readEntitlements(userId));

    if (!capability.hasWorkerAutoApply) {
      // بدونِ ورکر — واجدِ شرایط نیستند؛ تاگل رندر نمی‌شود، پس تنظیماتِ سرور را نمی‌خوانیم.
      return {
        capability,
        settings: { enabled: false, minScore: 0.7 },
      };
    }

    const settings = await getServerAutoApplySettings(userId);
    return { capability, settings };
  },
);
