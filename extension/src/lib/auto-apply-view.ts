/**
 * Pure rendering helpers for the auto-apply popup tab (Persian, RTL). Pure so the
 * popup stays a thin DOM binding and the wording is unit-tested.
 */
import type { AutoApplySettings, AutoApplyStatus } from "@ext/lib/types";

/** The on/off state line under the toggle. */
export function stateLabel(settings: AutoApplySettings): string {
  return settings.enabled ? "روشن — در پس‌زمینه فعال است" : "خاموش — هیچ اپلای خودکاری انجام نمی‌شود";
}

/** The match-threshold value formatted as a percentage (0.7 → "۷۰٪"-ish, ASCII). */
export function thresholdLabel(settings: AutoApplySettings): string {
  const pct = Math.round(clamp01(settings.minScore) * 100);
  return `${pct}٪`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** A human, non-secret "last run" summary line from a stored status (or null). */
export function lastRunLabel(status: AutoApplyStatus | null): string {
  if (!status) return "هنوز اجرا نشده";
  const when = formatWhen(status.ranAt);
  switch (status.outcome) {
    case "disabled":
      return `${when} — خاموش بود، چیزی اپلای نشد`;
    case "no_boards":
      return `${when} — هیچ سایتی متصل نیست`;
    case "not_paired":
      return `${when} — افزونه متصل نیست`;
    case "quota_reached":
      return `${when} — سقفِ روزانه پر شد (${status.submitted} اپلای)`;
    case "empty":
      return `${when} — موردِ واجدِ شرطی نبود`;
    case "applied":
      return `${when} — ${status.submitted} اپلای انجام شد${status.failed ? `، ${status.failed} ناموفق` : ""}`;
    case "error":
      return `${when} — خطا${status.message ? `: ${status.message}` : ""}`;
    default:
      return when;
  }
}

/** Short relative time, RTL-friendly. Injectable `now` for tests. */
export function formatWhen(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "همین حالا";
  if (min < 60) return `${min} دقیقه پیش`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ساعت پیش`;
  const day = Math.floor(hr / 24);
  return `${day} روز پیش`;
}
