/**
 * مزایای کاربر در کارجو — از اشتراکِ واحدِ 1xai خوانده می‌شود، نه از پلنِ محلی.
 *
 * کارجو پلن یا خریدِ اشتراکِ جداگانه ندارد. هر پلنِ 1xai در `features` دو کلید برای
 * کارجو دارد (internal/db/schema.sql در 1xai):
 *   • karjoo_unlimited_applies — بدونِ سقفِ روزانه‌ی اپلای (در غیرِ این صورت ۱۰۰ در روز)
 *   • karjoo_worker_ips        — تعدادِ ورکرِ سروری که بدونِ افزونه اپلای می‌کند
 *
 * این ماژول خالص است (بدونِ DB/شبکه) تا گیت‌ها و تست‌ها مستقیم از آن استفاده کنند.
 */

/** سقفِ روزانه‌ی اپلای وقتی اشتراک «اپلای نامحدود» ندارد. */
export const FREE_APPLY_QUOTA_PER_DAY = 100;

/** نشانیِ خرید/مدیریتِ اشتراکِ واحد در 1xai. */
export const ONEXAI_PLAN_URL = "https://1xai.ir/settings/plan";
export const ONEXAI_PLANS_URL = "https://1xai.ir/plans";
export const ONEXAI_TOPUP_URL = "https://1xai.ir/topup";

export interface Entitlements {
  /** کلیدِ پلنِ 1xai (free, plus, advanced, pro, max, company, enterprise). */
  planKey: string;
  planNameFa: string;
  /** "active" = اشتراکِ معتبر؛ "free" = بدونِ اشتراک. */
  status: "active" | "free";
  periodEnd: Date | null;
  unlimitedApplies: boolean;
  workerIpLimit: number;
  /** true وقتی 1xai در دسترس نبود و مقادیرِ رایگان (محافظه‌کارانه) جایگزین شد. */
  unavailable?: boolean;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  planKey: "free",
  planNameFa: "رایگان",
  status: "free",
  periodEnd: null,
  unlimitedApplies: false,
  workerIpLimit: 0,
};

export function entitlementsFromSubscription(sub: {
  planKey: string;
  nameFa: string;
  status: "active" | "free";
  periodEnd: Date | null;
  features: Record<string, unknown>;
}): Entitlements {
  const workers = Number(sub.features.karjoo_worker_ips ?? 0);
  return {
    planKey: sub.planKey,
    planNameFa: sub.nameFa,
    status: sub.status,
    periodEnd: sub.periodEnd,
    unlimitedApplies: sub.features.karjoo_unlimited_applies === true,
    workerIpLimit: Number.isFinite(workers) && workers > 0 ? Math.floor(workers) : 0,
  };
}

/** سقفِ روزانه‌ی اپلای؛ null = نامحدود. */
export function applyQuotaOf(e: Entitlements): number | null {
  return e.unlimitedApplies ? null : FREE_APPLY_QUOTA_PER_DAY;
}

export function workerIpLimitOf(e: Entitlements): number {
  return e.workerIpLimit;
}

/** برای تست‌ها و مقادیرِ پیش‌فرض: مزایای یک اشتراک با ورکر/بدونِ سقف. */
export function testEntitlements(patch: Partial<Entitlements> = {}): Entitlements {
  return { ...FREE_ENTITLEMENTS, ...patch };
}
