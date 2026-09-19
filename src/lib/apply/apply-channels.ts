import "server-only";

/**
 * «اپلایِ هر سایت از کجا اجرا می‌شود؟» — ماژولِ برگ (leaf).
 *
 * سه کانال داریم و هر سایت دقیقاً در یکی می‌نشیند:
 *
 *   • `control_plane` — اپلای یک تراکنشِ HTTP است (ایران‌تلنت، کاربوم، ای‌استخدام).
 *     همین‌جا روی وبِ کارجو اجرا می‌شود: بدونِ مرورگر، بدونِ نودِ ورکر.
 *   • `worker`        — اپلای یک فرم/جریانِ واقعیِ DOM است (جابینجا، جاب‌ویژن). نودِ
 *     ناوگان با Playwright نشستِ کاربر را replay می‌کند.
 *   • `extension`     — هنوز هیچ مسیرِ سروری ندارد؛ فقط افزونه روی مرورگرِ خودِ کاربر.
 *
 * چرا ماژولِ جداگانه و چرا برگ؟ چون هم `fleet/dispatch` (که باید بداند چه چیزی را به
 * نودِ ورکر *ندهد*) و هم `fleet/server-apply-runner` (که باید بداند چه چیزی را خودش
 * اجرا کند) به همین جدول نیاز دارند، و آن دو به هم import دارند. اگر جدول داخلِ یکی
 * از آن‌ها می‌ماند، چرخه‌ی import شکل می‌گرفت — همان دلیلی که `apply/registry.ts` هم
 * از `apply/index.ts` جدا شد.
 *
 * این فایل عمداً **هیچ** وابستگیِ سنگینی ندارد (نه DB، نه شبکه) تا هر لایه‌ای بتواند
 * بدونِ هزینه واردش کند.
 */
import type { JobBoardId } from "@/lib/apply/types";

export type ApplyChannel = "control_plane" | "worker" | "extension";

/**
 * کانالِ اپلایِ هر سایت — **تنها منبعِ حقیقت**.
 *
 * `Record<JobBoardId, …>` عمداً روی کلِ یونیون جامع است: اگر شناسه‌ی تازه‌ای به
 * `JobBoardId` اضافه شود، TypeScript تا وقتی کانالش این‌جا تعیین نشود کامپایل نمی‌کند
 * (fail-safe: هیچ سایتی به‌طور ضمنی «سرور اجرا می‌کند» نمی‌شود).
 */
export const APPLY_CHANNELS: Record<JobBoardId, ApplyChannel> = {
  // فرمِ DOM دارد → ورکر.
  jobinja: "worker",
  // SPA است؛ تأیید با تغییرِ مسیر و رزومه از پروفایلِ خودِ سایت → ورکر (جریانِ نوشته‌شده).
  jobvision: "worker",
  // APIِ JSON → کنترل‌پلین.
  "e-estekhdam": "control_plane",
  irantalent: "control_plane",
  // ویزاردِ سرورگردان، کاملاً HTTP → کنترل‌پلین.
  karboom: "control_plane",
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

/** آیا اپلایِ این سایت روی خودِ کنترل‌پلین اجرا می‌شود؟ */
export function isControlPlaneApplyBoard(board: string): boolean {
  return applyChannelOf(board) === "control_plane";
}

/** آیا اپلایِ این سایت روی نودِ ورکرِ ناوگان اجرا می‌شود؟ */
export function isWorkerApplyBoard(board: string): boolean {
  return applyChannelOf(board) === "worker";
}

/** آیا کارجو می‌تواند این سایت را **بدونِ** مرورگرِ کاربر اپلای کند؟ */
export function isServerApplyBoard(board: string): boolean {
  const channel = applyChannelOf(board);
  return channel === "control_plane" || channel === "worker";
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
