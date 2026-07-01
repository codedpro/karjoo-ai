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
 * برچسب + لحن + توضیحِ هر نوع رویدادِ ممیزیِ اپلای خودکار. خودِ آیکن در UI با نگاشتِ
 * `AuditIcon` در `auto-apply-panels.tsx` (بر پایه‌ی eventType، از `./icons`) رندر می‌شود —
 * این‌جا دیگر ایموجی نگه نمی‌داریم.
 */
export const AUTO_APPLY_EVENT_LABELS: Record<
  AutoApplyAuditEventType,
  { label: string; tone: Tone; description: string }
> = {
  auto_apply_enabled: {
    label: "روشن‌کردنِ اپلای خودکار",
    tone: "green",
    description: "شما رضایتِ اپلای خودکار را فعال کردید.",
  },
  auto_apply_disabled: {
    label: "خاموش‌کردنِ اپلای خودکار",
    tone: "muted",
    description: "شما اپلای خودکار را غیرفعال کردید.",
  },
  auto_apply_attempted: {
    label: "تلاش برای اپلای خودکار",
    tone: "brand",
    description: "یک فرصت از صف برای اپلای خودکار برداشته شد.",
  },
  auto_apply_skipped: {
    label: "ردِ یک فرصت",
    tone: "amber",
    description: "یک فرصت به‌دلیلِ آستانه/سقف/خاموش‌بودنِ تاگل اپلای نشد.",
  },
  server_auto_apply_enabled: {
    label: "روشن‌کردنِ اپلای خودکارِ سرور",
    tone: "green",
    description: "شما اپلای خودکارِ سرور (۲۴ ساعته، Max/Max+) را فعال کردید.",
  },
  server_auto_apply_disabled: {
    label: "خاموش‌کردنِ اپلای خودکارِ سرور",
    tone: "muted",
    description: "شما اپلای خودکارِ سرور را غیرفعال کردید.",
  },
};

/** برچسبِ فارسیِ یک رویدادِ ممیزی (با fallback امن). */
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
