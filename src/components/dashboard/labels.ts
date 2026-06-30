/**
 * برچسب‌های فارسیِ ثابت‌ها (سایت‌ها/وضعیت‌ها) — یک‌جا، تا در همه‌ی صفحه‌ها یکدست بماند.
 * صرفاً نگاشتِ نمایشی است؛ هیچ منطق/داده‌ای.
 */

/** نامِ فارسیِ هر سایت کاریابی (کلیدها = enumِ job_board). */
export const BOARD_LABELS: Record<string, string> = {
  jobvision: "جاب‌ویژن",
  jobinja: "جابینجا",
  "e-estekhdam": "ای‌استخدام",
  karboom: "کاربوم",
  linkedin: "لینکدین",
};

export function boardLabel(board: string): string {
  return BOARD_LABELS[board] ?? board;
}

/** برچسب + لحنِ نشانِ وضعیتِ تطبیق. */
export const MATCH_STATUS: Record<
  string,
  { label: string; tone: "brand" | "accent" | "muted" | "green" | "amber" | "rose" }
> = {
  pending: { label: "در صف امتیازدهی", tone: "muted" },
  scored: { label: "امتیازگرفته", tone: "muted" },
  drafted: { label: "آماده‌ی اپلای", tone: "brand" },
  queued: { label: "در صفِ اپلای", tone: "accent" },
  dismissed: { label: "رد شده", tone: "muted" },
};

/** برچسب + لحنِ نشانِ وضعیتِ اپلای. */
export const APPLICATION_STATUS: Record<
  string,
  { label: string; tone: "brand" | "accent" | "muted" | "green" | "amber" | "rose" }
> = {
  draft: { label: "پیش‌نویس", tone: "muted" },
  submitted: { label: "ارسال‌شده", tone: "green" },
  skipped: { label: "رد‌شده", tone: "amber" },
  failed: { label: "ناموفق", tone: "rose" },
};

/** کانالِ اجرای اپلای. */
export const CHANNEL_LABELS: Record<string, string> = {
  extension: "افزونه‌ی مرورگر",
  worker: "نود ایرانی",
};

/** وضعیتِ اتصالِ حسابِ سایت. */
export const BOARD_ACCOUNT_STATUS: Record<
  string,
  { label: string; tone: "green" | "amber" | "rose" }
> = {
  connected: { label: "متصل", tone: "green" },
  expired: { label: "منقضی", tone: "amber" },
  needs_reauth: { label: "نیازمند اتصال مجدد", tone: "rose" },
};
