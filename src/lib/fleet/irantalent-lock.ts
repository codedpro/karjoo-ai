import "server-only";

/**
 * قفلِ مشورتیِ تیکِ اپلایِ ایران‌تلنت.
 *
 * دو تیکِ هم‌پوشان می‌توانند یک وظیفه را دوبار برداشته و برای یک آگهی دوبار اپلای کنند.
 * قفل روی یک کانکشنِ رزروشده گرفته می‌شود (الزامِ pg_advisory_lockِ سطحِ نشست).
 */
import { client } from "@/db";

/** کلیدِ اختصاصیِ این کار — نباید با قفلِ کشف یکی باشد. */
const IRANTALENT_APPLY_LOCK_KEY = 947_120_311;

export async function withIranTalentApplyLock<T>(
  fn: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  const reserved = await client.reserve();
  try {
    const rows = await reserved`SELECT pg_try_advisory_lock(${IRANTALENT_APPLY_LOCK_KEY}) AS ok`;
    if (rows[0]?.ok !== true) return onBusy();
    try {
      return await fn();
    } finally {
      await reserved`SELECT pg_advisory_unlock(${IRANTALENT_APPLY_LOCK_KEY})`;
    }
  } finally {
    reserved.release();
  }
}
