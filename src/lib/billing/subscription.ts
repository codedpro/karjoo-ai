import "server-only";

/**
 * خواندنِ مزایای کارجو از اشتراکِ واحدِ 1xai (server-only).
 *
 * نتیجه برای هر کاربر ۶۰ ثانیه (و شکست ۱۵ ثانیه) در حافظه می‌ماند: گیت‌های اپلای در هر claim صدا زده
 * می‌شوند و نباید هر بار به 1xai بروند. اگر 1xai در دسترس نباشد، مزایای رایگان
 * (سقفِ روزانه، بدونِ ورکر) برمی‌گردد — هیچ مزیتِ پولی بدونِ تأیید داده نمی‌شود.
 */
import {
  FREE_ENTITLEMENTS,
  entitlementsFromSubscription,
  type Entitlements,
} from "@/lib/billing/entitlements";
import { ensureOnexaiLink, type UnifiedDeps } from "@/lib/billing/unified";
import { getPoolSubscription } from "@/lib/onexai/svc";
import { logger } from "@/lib/observability/logger";

const CACHE_TTL_MS = 60_000;
/**
 * پاسخِ «در دسترس نیست» هم کوتاه کش می‌شود: هر فراخوانیِ svc تا ۸ ثانیه منتظر می‌ماند و
 * بدونِ این کش، هنگامِ قطعیِ 1xai هر گیت و هر صفحه همین مکث را تکرار می‌کرد.
 */
const FAILURE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: Entitlements }>();

export interface SubscriptionDeps extends UnifiedDeps {
  getPoolSubscriptionFn?: typeof getPoolSubscription;
  now?: () => number;
  /** بدونِ کش بخوان (مثلاً صفحه‌ی اشتراک پس از بازگشت از 1xai). */
  fresh?: boolean;
}

export async function readEntitlements(
  karjooUserId: string,
  deps: SubscriptionDeps = {},
): Promise<Entitlements> {
  const now = deps.now?.() ?? Date.now();
  const hit = cache.get(karjooUserId);
  if (!deps.fresh && hit) {
    const ttl = hit.value.unavailable ? FAILURE_TTL_MS : CACHE_TTL_MS;
    if (now - hit.at < ttl) return hit.value;
  }

  try {
    const poolId = await ensureOnexaiLink(karjooUserId, deps);
    const sub = await (deps.getPoolSubscriptionFn ?? getPoolSubscription)(poolId);
    const value = entitlementsFromSubscription(sub);
    cache.set(karjooUserId, { at: now, value });
    return value;
  } catch (err) {
    logger.warn("1xai subscription unavailable; using free entitlements", {
      path: "billing/subscription",
      userId: karjooUserId,
      err: err instanceof Error ? err : new Error(String(err)),
    });
    const value: Entitlements = { ...FREE_ENTITLEMENTS, unavailable: true };
    cache.set(karjooUserId, { at: now, value });
    return value;
  }
}

/** فقط برای تست. */
export function clearEntitlementsCache(): void {
  cache.clear();
}
