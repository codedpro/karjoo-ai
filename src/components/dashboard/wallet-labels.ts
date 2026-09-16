/**
 * برچسب‌های فارسیِ بیلینگ (نوعِ دفتر/نوعِ مصرف) — Track B.
 *
 * عمداً جدا از `labels.ts` (که Track A ویرایش می‌کند) نگه داشته شده تا تداخلی نباشد.
 * صرفاً نگاشتِ نمایشی است؛ هیچ منطق/داده‌ای. اعداد جای دیگری به ارقامِ فارسی می‌شوند.
 */
import type { LedgerKind, UsageKind } from "@/db/schema";

type Tone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

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
  resume_tailor: "رزومه‌ی سفارشیِ شغل",
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
