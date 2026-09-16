import "server-only";

/**
 * گاردِ سهمیه‌ی اپلای «به‌ازای userId» — یک wrapperِ نازک روی assertApplyQuota که
 * مزایای کاربر را از اشتراکِ واحدِ 1xai می‌خواند.
 *
 * چرا این لایه؟ نقطه‌ی ثبتِ اپلای (مسیرِ نتیجه‌ی صفِ افزونه) فقط `userId` احرازشده را
 * دارد. این تابع مزایا را امن می‌خواند (پیش‌فرضِ محتاطانه رایگان) و گارد را اعمال می‌کند.
 *
 * مالکیت/قاعده‌ی ۴: کاربر همیشه از نشست می‌آید (نه از بدنه)؛ این تابع فقط با همان
 * userId کار می‌کند و سقف را برای *همان* کاربر می‌سنجد.
 *
 * همه‌ی وابستگی‌ها تزریق‌پذیرند تا بدونِ DB تست شود.
 */
import type { Entitlements } from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
import {
  assertApplyQuota,
  type ApplyQuotaDeps,
  type ApplyQuotaStatus,
} from "@/lib/billing/apply-quota";

/** وابستگی‌های قابلِ تزریقِ گارد — برای تستِ بدونِ DB. */
export interface ApplyQuotaGuardDeps extends ApplyQuotaDeps {
  /** خواننده‌ی مزایای کاربر (پیش‌فرض اشتراکِ 1xai؛ خطا → رایگان). */
  readEntitlements?: (userId: string) => Promise<Entitlements>;
}

/** مزایای کاربر از اشتراکِ واحدِ 1xai (در دسترس نبودن → مزایای رایگان). */
export async function readUserEntitlements(userId: string): Promise<Entitlements> {
  return readEntitlements(userId);
}

/**
 * سهمیه‌ی اپلای روزانه‌ی این کاربر را تأیید می‌کند (با خواندنِ اشتراک)، وگرنه
 * `ApplyQuotaError` (typed) پرتاب می‌کند. این را *پیش از* ثبتِ یک اپلایِ تازه صدا بزنید.
 *
 * اشتراک‌های «اپلای نامحدود» همیشه عبور می‌کنند و هیچ کوئریِ شمارشی نمی‌زنند.
 *
 * @returns وضعیتِ سهمیه (سقف/مصرف/باقی‌مانده) در صورتِ مجاز بودن.
 */
export async function assertApplyQuotaForUser(
  userId: string,
  deps: ApplyQuotaGuardDeps = {},
): Promise<ApplyQuotaStatus> {
  const read = deps.readEntitlements ?? readUserEntitlements;
  return assertApplyQuota(userId, await read(userId), deps);
}
