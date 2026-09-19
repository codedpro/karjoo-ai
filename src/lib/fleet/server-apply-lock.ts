import "server-only";

/**
 * قفلِ مشورتیِ تیکِ «اپلایِ سمتِ سرور».
 *
 * دو تیکِ هم‌پوشان می‌توانند یک وظیفه را دوبار برداشته و برای یک آگهی دوبار اپلای کنند.
 * قفل روی یک کانکشنِ رزروشده گرفته می‌شود (الزامِ pg_advisory_lockِ سطحِ نشست).
 *
 * **یک** کلید برای همه‌ی سایت‌های کنترل‌پلین، عمداً: کلیدِ جداگانه‌ی هر سایت یعنی تیکِ
 * قدیمیِ ایران‌تلنت و تیکِ عمومی می‌توانستند هم‌زمان اجرا شوند و همان آگهی را دوبار
 * بفرستند. همین کلید از زمانِ ایران‌تلنت دست‌نخورده مانده تا تیک‌های در حالِ اجرا هم
 * با تیکِ جدید سریالایز شوند.
 */
import { client } from "@/db";

const SERVER_APPLY_LOCK_KEY = 947_120_311;

export async function withServerApplyLock<T>(
  fn: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  const reserved = await client.reserve();
  try {
    const rows = await reserved`SELECT pg_try_advisory_lock(${SERVER_APPLY_LOCK_KEY}) AS ok`;
    if (rows[0]?.ok !== true) return onBusy();
    try {
      return await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${SERVER_APPLY_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}
