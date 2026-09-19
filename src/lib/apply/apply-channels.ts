import "server-only";

/**
 * «اپلایِ هر سایت چطور اجرا می‌شود؟» — ماژولِ برگ (leaf).
 *
 * **همه‌ی** اپلای‌های سمتِ سرور روی نودِ ناوگان اجرا می‌شوند، نه روی کنترل‌پلین. دلیلش
 * شبکه است، نه معماری: سایت‌های پشتِ ArvanCloud اتصالِ TCP را از یک IPِ غیرِایرانی
 * می‌پذیرند و بعد هرگز به دست‌دادنِ TLS پاسخ نمی‌دهند. نود همان چیزی است که IPِ
 * ایرانی دارد، پس هر درخواستی به سایت‌های کاریابی باید از آن‌جا برود — چه مرورگر
 * لازم داشته باشد چه نه. (پیش‌تر کاربوم/ایران‌تلنت/ای‌استخدام روی کنترل‌پلین اجرا
 * می‌شدند؛ دقیقاً جایی که هیچ‌وقت نمی‌توانستند کار کنند.)
 *
 * پس تفاوتِ واقعیِ سایت‌ها «کجا» نیست، «چطور» است:
 *
 *   • `worker_browser` — فرم/جریانِ واقعیِ DOM دارد (جابینجا، جاب‌ویژن). نود با
 *     Playwright نشستِ کاربر را replay می‌کند.
 *   • `worker_http`    — کلِ اپلای چند درخواستِ HTTP است (کاربوم، ای‌استخدام،
 *     ایران‌تلنت). نود همان آداپتورها را بدونِ مرورگر اجرا می‌کند؛ مرورگر فقط اگر
 *     رزومه‌ی اختصاصیِ آگهی باید رندر شود بالا می‌آید.
 *   • `extension`      — هنوز هیچ مسیرِ سروری ندارد؛ فقط افزونه روی مرورگرِ خودِ کاربر.
 *
 * چرا ماژولِ جداگانه و چرا برگ؟ چون `fleet/dispatch` و لایه‌های UI هر دو به همین جدول
 * نیاز دارند و نباید برای یک نگاشتِ ساده به هم وابسته شوند — همان دلیلی که
 * `apply/registry.ts` هم از `apply/index.ts` جدا شد.
 *
 * این فایل عمداً **هیچ** وابستگیِ سنگینی ندارد (نه DB، نه شبکه) تا هر لایه‌ای بتواند
 * بدونِ هزینه واردش کند.
 */
import type { JobBoardId } from "@/lib/apply/types";

export type ApplyChannel = "worker_browser" | "worker_http" | "extension";

/**
 * کانالِ اپلایِ هر سایت — **تنها منبعِ حقیقت**.
 *
 * `Record<JobBoardId, …>` عمداً روی کلِ یونیون جامع است: اگر شناسه‌ی تازه‌ای به
 * `JobBoardId` اضافه شود، TypeScript تا وقتی کانالش این‌جا تعیین نشود کامپایل نمی‌کند
 * (fail-safe: هیچ سایتی به‌طور ضمنی «سرور اجرا می‌کند» نمی‌شود).
 */
export const APPLY_CHANNELS: Record<JobBoardId, ApplyChannel> = {
  // فرمِ DOM دارد → مرورگرِ نود.
  jobinja: "worker_browser",
  // SPA است؛ تأیید با تغییرِ مسیر و رزومه از پروفایلِ خودِ سایت → جریانِ نوشته‌شده‌ی مرورگر.
  jobvision: "worker_browser",
  // APIِ JSON → HTTPِ نود.
  "e-estekhdam": "worker_http",
  irantalent: "worker_http",
  // ویزاردِ سرورگردان، کاملاً HTTP → HTTPِ نود.
  karboom: "worker_http",
  // هنوز آداپتورِ سروری ندارند.
  linkedin: "extension",
  iranestekhdam: "extension",
  divar: "extension",
  quera: "extension",
  remoteok: "extension",
  weworkremotely: "extension",
  ponisha: "extension",
  parscoders: "extension",
  bankestekhdam: "extension",
};

/** کانالِ اپلایِ یک سایت. شناسه‌ی ناشناخته → `extension` (fail-closed: سرور اجرا نمی‌کند). */
export function applyChannelOf(board: string): ApplyChannel {
  return APPLY_CHANNELS[board as JobBoardId] ?? "extension";
}

/** آیا اپلایِ این سایت بدونِ مرورگر و فقط با HTTP انجام می‌شود؟ */
export function isHttpApplyBoard(board: string): boolean {
  return applyChannelOf(board) === "worker_http";
}

/**
 * آیا این سایت به نودِ ناوگان دیسپچ می‌شود؟
 *
 * هر دو کانالِ نود را می‌گیرد: نود هم کارِ مرورگری اجرا می‌کند و هم کارِ HTTPی. این
 * همان گیتی است که dispatch استفاده می‌کند تا فقط سایت‌های «سرور-اجراشدنی» claim شوند.
 */
export function isWorkerApplyBoard(board: string): boolean {
  const channel = applyChannelOf(board);
  return channel === "worker_browser" || channel === "worker_http";
}

/** آیا کارجو می‌تواند این سایت را **بدونِ** مرورگرِ کاربر اپلای کند؟ */
export function isServerApplyBoard(board: string): boolean {
  return isWorkerApplyBoard(board);
}

/** سایت‌های یک کانال. */
export function boardsForChannel(channel: ApplyChannel): JobBoardId[] {
  return (Object.keys(APPLY_CHANNELS) as JobBoardId[]).filter(
    (board) => APPLY_CHANNELS[board] === channel,
  );
}

/** سایت‌هایی که اپلای‌شان از سمتِ سرور (هر کدام از دو کانال) اجرا می‌شود. */
export function serverApplyBoards(): JobBoardId[] {
  return (Object.keys(APPLY_CHANNELS) as JobBoardId[]).filter(isServerApplyBoard);
}
