/**
 * برچسب‌های فارسیِ بیلینگ (پلن/نوعِ دفتر/نوعِ مصرف) — Track B.
 *
 * عمداً جدا از `labels.ts` (که Track A ویرایش می‌کند) نگه داشته شده تا تداخلی نباشد.
 * صرفاً نگاشتِ نمایشی است؛ هیچ منطق/داده‌ای. اعداد جای دیگری به ارقامِ فارسی می‌شوند.
 */
import type { LedgerKind, Plan, UsageKind } from "@/db/schema";

type Tone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

/** برچسب + لحن + توضیحِ پلنِ کاربر. */
export const PLAN_BADGE: Record<Plan, { label: string; tone: Tone; title: string }> = {
  free: {
    label: "رایگان",
    tone: "muted",
    title: "پلنِ رایگان — فقط آپلودِ رزومه و استخراجِ متن؛ سرویس‌های هوش مصنوعی نیازمندِ ارتقا یا شارژ است.",
  },
  payg: {
    label: "پرداخت به‌میزانِ مصرف",
    tone: "brand",
    title: "هر فراخوانیِ هوش مصنوعی به‌اندازه‌ی مصرف از کیف‌پول کسر می‌شود.",
  },
  premium: {
    label: "پریمیوم",
    tone: "accent",
    title: "اعتبارِ هدیه + امکاناتِ بیشتر؛ کسرِ مصرف از همان موجودی.",
  },
  pro: {
    label: "حرفه‌ای",
    tone: "brand",
    title: "اعتبارِ ماهانه‌ی هوش مصنوعی + اپلای نامحدود؛ کسرِ مصرف از همان موجودی.",
  },
  max: {
    label: "مکس",
    tone: "accent",
    title: "اعتبارِ ماهانه‌ی بیشتر + اپلای نامحدود + اپلای خودکارِ ورکر.",
  },
  maxplus: {
    label: "مکس پلاس",
    tone: "accent",
    title: "بیشترین اعتبارِ ماهانه + چند IPِ ورکر + تماسِ مستقیم.",
  },
};

/** برچسب + لحنِ نوعِ ردیفِ دفترِ کیف‌پول. */
export const LEDGER_KIND: Record<LedgerKind, { label: string; tone: Tone }> = {
  topup: { label: "شارژ", tone: "green" },
  charge: { label: "کسرِ مصرف", tone: "muted" },
  refund: { label: "بازگشت", tone: "accent" },
  grant: { label: "هدیه", tone: "brand" },
};

/** برچسبِ فارسیِ نوعِ مصرفِ هوش مصنوعی. */
export const USAGE_KIND: Record<UsageKind, string> = {
  match: "تطبیقِ شغلی",
  cover_letter: "انگیزه‌نامه",
  resume_parse: "پردازشِ رزومه",
};

/** نامِ فارسیِ ارائه‌دهنده‌ی مدل. */
export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
