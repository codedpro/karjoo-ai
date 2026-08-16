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

/**
 * وضعیتِ آماده‌به‌کار بودنِ هر سایت — **تنها منبعِ حقیقت** برای «آیا این سایت واقعاً
 * کار می‌کند؟». عمداً اینجا (نه داخلِ لیترالِ هر کانکتور در boards/*.ts) نگه داشته
 * می‌شود تا افزودنِ این پرچم به تداخلِ فایل با ترک‌های دیگر نینجامد.
 *
 *   • `live`        — search()/apply() واقعاً پیاده شده‌اند (فقط جابینجا).
 *   • `coming_soon` — کانکتور داربست است؛ search()/apply() هنوز throw می‌کنند.
 *
 * `Record<JobBoardId, …>` عمداً روی کلِ یونیونِ JobBoardId جامع است؛ اگر شناسه‌ی
 * تازه‌ای به یونیون اضافه شود، TypeScript تا زمانِ افزودنِ وضعیتِ آن اینجا کامپایل
 * نمی‌شود (fail-safe: پیش‌فرضِ ضمنی «زنده» وجود ندارد).
 */
export const BOARD_STATUS: Record<JobBoardId, "live" | "extension_only" | "coming_soon"> = {
  jobinja: "live",
  jobvision: "extension_only",
  "e-estekhdam": "coming_soon",
  irantalent: "coming_soon",
  karboom: "coming_soon",
  linkedin: "coming_soon",
};

/**
 * آیا سایتِ داده‌شده واقعاً کار می‌کند؟ ورودی `string` است (نه JobBoardId) تا در
 * مرزهای اعتبارسنجی (مثلِ بدنه‌ی درخواست) بدونِ cast قابلِ استفاده باشد؛ شناسه‌ی
 * ناشناخته → `false` (fail-closed).
 */
export function isBoardLive(id: string): boolean {
  return BOARD_STATUS[id as JobBoardId] === "live";
}

/** Boards that can be connected in the extension, including browser-only adapters. */
export function isBoardConnectable(id: string): boolean {
  const status = BOARD_STATUS[id as JobBoardId];
  return status === "live" || status === "extension_only";
}

/** فهرستِ شناسه‌ی سایت‌هایی که واقعاً کار می‌کنند — درزِ یکپارچگی برای orchestrator. */
export function liveBoardIds(): JobBoardId[] {
  return (Object.keys(BOARD_STATUS) as JobBoardId[]).filter(
    (id) => BOARD_STATUS[id] === "live",
  );
}
