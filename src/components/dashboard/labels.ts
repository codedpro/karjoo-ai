/**
 * برچسب‌های فارسیِ ثابت‌ها (سایت‌ها/وضعیت‌ها) — یک‌جا، تا در همه‌ی صفحه‌ها یکدست بماند.
 * صرفاً نگاشتِ نمایشی است؛ هیچ منطق/داده‌ای.
 */

/** نامِ فارسیِ هر سایت کاریابی (کلیدها = enumِ job_board). */
export const BOARD_LABELS: Record<string, string> = {
  jobvision: "جاب‌ویژن",
  jobinja: "جابینجا",
  "e-estekhdam": "ای‌استخدام",
  irantalent: "ایران‌تلنت",
  karboom: "کاربوم",
  linkedin: "لینکدین",
};

export function boardLabel(board: string): string {
  return BOARD_LABELS[board] ?? board;
}

/**
 * برچسب + لحنِ نشانِ وضعیتِ تطبیق.
 *
 * برچسب‌ها *کاری*اند نه فنی: کاربر باید از روی نشان بفهمد کارِ بعدی چیست، نه اینکه در
 * خطِ لوله‌ی داخلیِ ما چه اتفاقی افتاده («فیلترشده» را کسی نمی‌فهمید).
 */
export const MATCH_STATUS: Record<
  string,
  { label: string; tone: "brand" | "accent" | "muted" | "green" | "amber" | "rose" }
> = {
  pending: { label: "در صفِ بررسی", tone: "muted" },
  scored: { label: "بررسی‌شده", tone: "muted" },
  drafted: { label: "آماده‌ی ارسال", tone: "brand" },
  queued: { label: "در صفِ ارسال", tone: "accent" },
  dismissed: { label: "کنار گذاشته شد", tone: "muted" },
};

/** برچسب + لحنِ نشانِ وضعیتِ اپلای. */
export const APPLICATION_STATUS: Record<
  string,
  { label: string; tone: "brand" | "accent" | "muted" | "green" | "amber" | "rose" }
> = {
  draft: { label: "پیش‌نویس", tone: "muted" },
  submitted: { label: "ارسال‌شده", tone: "green" },
  skipped: { label: "ارسال نشد", tone: "amber" },
  failed: { label: "ناموفق", tone: "rose" },
};

/** کانالِ اجرای اپلای — «نودِ ایرانی» اصطلاحِ زیرساختِ ماست، نه چیزی که کاربر بشناسد. */
export const CHANNEL_LABELS: Record<string, string> = {
  extension: "افزونه‌ی مرورگر",
  worker: "سرورِ کارجو (۲۴/۷)",
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

/**
 * برچسب + لحنِ نشانِ تگ‌های مدلِ هوش مصنوعی (Track A). کلیدها = تگ‌های catalog-sync
 * (recommended/premium/cheap/fast/persian). توضیح (title) برای راهنمای کاربر.
 */
export const MODEL_TAGS: Record<
  string,
  {
    label: string;
    tone: "brand" | "accent" | "muted" | "green" | "amber" | "rose";
    title: string;
  }
> = {
  recommended: {
    label: "پیشنهادی",
    tone: "brand",
    title: "انتخابِ متعادلِ پیشنهادیِ کارجو برای این ارائه‌دهنده",
  },
  premium: {
    label: "پریمیوم",
    tone: "accent",
    title: "قوی‌ترین و گران‌ترین مدلِ این ارائه‌دهنده",
  },
  cheap: {
    label: "اقتصادی",
    tone: "green",
    title: "کم‌هزینه — مناسبِ مصرفِ زیاد",
  },
  fast: { label: "سریع", tone: "amber", title: "پاسخِ سریع‌تر با تأخیرِ کم" },
  persian: {
    label: "فارسیِ بهتر",
    tone: "muted",
    title: "کیفیتِ بهترِ زبانِ فارسی",
  },
};

/** ترتیبِ نمایشِ تگ‌ها روی کارتِ مدل (مهم‌ترین اول). */
export const MODEL_TAG_ORDER = [
  "recommended",
  "premium",
  "cheap",
  "fast",
  "persian",
] as const;
