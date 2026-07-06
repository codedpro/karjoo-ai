import "server-only";

/**
 * محدودسازِ نرخِ سبکِ درون‌حافظه‌ای (per-key، پنجره‌ی ثابت).
 *
 * برای گاردهای ارزانِ ضدِسوءاستفاده روی اندپوینت‌های گران/حساس (مثلِ find-jobs که یک
 * اسکرَیپِ همزمانِ سمتِ سرور می‌زند). حالتش فقط در همین فرایند می‌ماند؛ در پروداکشنِ
 * چندنمونه‌ای باید به Redis منتقل شود (مثلِ محدودسازِ OTP در auth/http.ts).
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** ثانیه تا بازنشانیِ پنجره (۰ اگر مجاز) — برای هدرِ Retry-After. */
  retryAfterSec: number;
}

/**
 * اگر `key` در پنجره‌ی جاری از `max` بگذرد، `allowed:false` با ثانیه‌ی باقی‌مانده
 * برمی‌گرداند؛ وگرنه شمارنده را زیاد و `allowed:true` می‌دهد. زمان تزریق‌پذیر برای تست.
 */
export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (b.count >= max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** پاک‌سازیِ حالتِ محدودساز (فقط برای تست — جداسازیِ بین تست‌ها). */
export function resetRateLimits(): void {
  buckets.clear();
}
