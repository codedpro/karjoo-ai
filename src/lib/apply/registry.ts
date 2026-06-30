import "server-only";

/**
 * رجیستریِ کانکتورهای سایت‌های کاریابی — ماژولِ برگ (leaf).
 *
 * چرا جدا از index.ts؟ index.ts بشکه‌ی (barrel) عمومیِ این دامنه است و
 * orchestrator.ts را هم صادر مجدد می‌کند؛ اما orchestrator خودش به رجیستری نیاز دارد.
 * اگر رجیستری داخلِ index.ts می‌ماند، چرخه‌ی import (index → orchestrator → index)
 * شکل می‌گرفت. با گذاشتنِ رجیستری در این ماژولِ برگ، هم index و هم orchestrator
 * مستقیماً از اینجا import می‌کنند و چرخه‌ای نیست.
 */
import { eEstekhdam } from "@/lib/apply/boards/e-estekhdam";
import { irantalent } from "@/lib/apply/boards/irantalent";
import { jobinja } from "@/lib/apply/boards/jobinja";
import { jobvision } from "@/lib/apply/boards/jobvision";
import type { JobBoardConnector, JobBoardId } from "@/lib/apply/types";

/**
 * ثبت کانکتورها — افزودن سایت کاریابی تازه = یک ورودی اینجا.
 *
 * چهار سایتِ هدفِ WF1 ثبت شده‌اند (jobinja, jobvision, e-estekhdam, irantalent).
 * karboom/linkedin عمداً ثبت نشده‌اند (هنوز در دامنه‌ی محصول نیستند).
 */
export const connectors: Record<string, JobBoardConnector> = {
  [jobvision.id]: jobvision,
  [jobinja.id]: jobinja,
  [eEstekhdam.id]: eEstekhdam,
  [irantalent.id]: irantalent,
  // karboom/linkedin هنوز ثبت نشده‌اند.
};

export function getConnector(id: JobBoardId): JobBoardConnector | undefined {
  return connectors[id];
}
