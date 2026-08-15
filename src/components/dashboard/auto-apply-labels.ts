/**
 * برچسب‌ها و کمک‌کننده‌های نمایشیِ صفحه‌ی «اپلای خودکار» (Track A).
 *
 * صرفاً نگاشتِ نمایشی/خالص است؛ هیچ I/O، هیچ راز. عمداً جدا از `labels.ts` نگه داشته
 * شده تا تداخلِ مالکیتی نباشد. اعداد جای دیگری با `toFaDigits` فارسی می‌شوند.
 */
import type { AutoApplyAuditEventType } from "./auto-apply-data";
import { boardLabel as sharedBoardLabel } from "./labels";

type Tone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

/**
 * برچسب + لحن + توضیحِ هر رویدادِ «تاریخچه‌ی تغییرات». خودِ آیکن در UI با نگاشتِ
 * `AuditIcon` در `auto-apply-panels.tsx` (بر پایه‌ی eventType، از `./icons`) رندر می‌شود —
 * این‌جا دیگر ایموجی نگه نمی‌داریم.
 *
 * قاعده‌ی نگارش: هیچ اصطلاحِ داخلی («آستانه»، «صف»، «تاگل»، نامِ پلن) در متنی که کاربر
 * می‌خواند نمی‌آید؛ هر جمله می‌گوید *چه اتفاقی افتاد*، نه اینکه کدام کلید عوض شد.
 */
export const AUTO_APPLY_EVENT_LABELS: Record<
  AutoApplyAuditEventType,
  { label: string; tone: Tone; description: string }
> = {
  auto_apply_enabled: {
    label: "اپلای خودکار روشن شد",
    tone: "green",
    description: "تو اجازه دادی کارجو به‌جای تو درخواست بفرستد.",
  },
  auto_apply_disabled: {
    label: "اپلای خودکار خاموش شد",
    tone: "muted",
    description: "از این پس چیزی بدونِ تأییدِ تو فرستاده نمی‌شود.",
  },
  auto_apply_attempted: {
    label: "تلاش برای ارسال",
    tone: "brand",
    description: "یک آگهی از نوبتِ ارسال برداشته شد.",
  },
  auto_apply_skipped: {
    label: "از یک آگهی صرف‌نظر شد",
    tone: "amber",
    description:
      "یا امتیازِ آگهی از حداقلِ امتیازِ تو کمتر بود، یا سقفِ روزانه پر شده بود.",
  },
  server_auto_apply_enabled: {
    label: "ارسال از سرورهای کارجو روشن شد",
    tone: "green",
    description: "کارجو حتی وقتی مرورگرت بسته است هم درخواست می‌فرستد.",
  },
  server_auto_apply_disabled: {
    label: "ارسال از سرورهای کارجو خاموش شد",
    tone: "muted",
    description: "ارسال فقط وقتی انجام می‌شود که مرورگر و افزونه باز باشند.",
  },
};

/** برچسبِ فارسیِ یک رویدادِ تاریخچه (با fallback امن). */
export function autoApplyEventLabel(eventType: string): {
  label: string;
  tone: Tone;
  description: string;
} {
  return (
    AUTO_APPLY_EVENT_LABELS[eventType as AutoApplyAuditEventType] ?? {
      label: eventType,
      tone: "muted",
      description: "",
    }
  );
}

/** نامِ فارسیِ سایت — روی برچسب‌های مشترک سوار است، با fallbackِ ایران‌تلنت. */
const EXTRA_BOARD_LABELS: Record<string, string> = {
  irantalent: "ایران‌تلنت",
};

export function boardLabel(board: string): string {
  const shared = sharedBoardLabel(board);
  // اگر برچسبِ مشترک خودِ کلید را برگرداند (یعنی نگاشتی نداشت)، fallbackِ محلی را بده.
  if (shared !== board) return shared;
  return EXTRA_BOARD_LABELS[board] ?? board;
}

/** متنِ «امروز X از Y» برای سهمیه‌ی اپلای — null یعنی نامحدود. */
export function applyUsageLabel(usedToday: number, limit: number | null): string {
  if (limit === null) return `${usedToday} اپلای امروز (بدونِ سقف)`;
  return `${usedToday} از ${limit} اپلای امروز`;
}

/** درصدِ مصرفِ سهمیه‌ی امروز (۰..۱۰۰) برای نوارِ پیشرفت — نامحدود → ۰. */
export function applyUsagePct(usedToday: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((usedToday / limit) * 100));
}
