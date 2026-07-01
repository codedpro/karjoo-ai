/**
 * برچسب‌ها و کمک‌کننده‌های نمایشیِ «ناوگانِ اپلای» (Track C) — خالص، بدونِ I/O/راز.
 *
 * این فایل دو بخش دارد:
 *   ۱) نگاشتِ «پلن → قابلیتِ اپلای خودکارِ ورکر» (planFleetCapability): آیا این پلن
 *      سرورِ اپلای دارد و حداکثر چند IP؟ این تنها منبعِ حقیقتِ نمایش است و سقفِ IP را
 *      از خودِ plans.ts (workerIpLimitFor) می‌گیرد تا با Foundation هم‌خوان بماند.
 *   ۲) کمک‌کننده‌های نمایشیِ ادمین: برچسبِ سلامتِ نود، فاصله‌ی زمانیِ «چند پیش»،
 *      وضعیتِ تازگیِ نشست (fresh/stale)، و قالبِ امنِ نسخه/شناسه.
 *
 * صرفاً نگاشت/فرمت است؛ هیچ کوئری/رازی. اعداد جای دیگری با `toFaDigits` فارسی می‌شوند.
 */
import type { Plan } from "@/db/schema";
import { normalizePlanKey, planFor, workerIpLimitFor, type PlanKey } from "@/lib/billing/plans";

type Tone = "brand" | "accent" | "muted" | "green" | "amber" | "rose";

/* ───────────────────────  پلن → قابلیتِ سرورِ اپلای  ─────────────────────── */

/** خلاصه‌ی قابلیتِ اپلای خودکارِ ورکرِ یک پلن (برای پنلِ کاربر و دروازه‌بانیِ UI). */
export interface PlanFleetCapability {
  /** کلیدِ پلنِ نرمال‌شده (payg→free، premium→pro). */
  planKey: PlanKey;
  /** نامِ نمایشیِ فارسیِ پلن. */
  planLabelFa: string;
  /** سقفِ IPِ ورکر (Free/Pro=۰، Max=۱، MaxPlus=۵). */
  workerIpLimit: number;
  /** آیا این پلن اصلاً اپلای خودکارِ سرورِ اپلای دارد؟ (workerIpLimit > 0). */
  hasWorkerAutoApply: boolean;
}

/**
 * قابلیتِ سرورِ اپلای را برای پلنِ خامِ کاربر برمی‌گرداند. هرگز throw نمی‌کند:
 * پلن‌های تاریخی/ناشناخته به‌صورتِ دفاعی نرمال می‌شوند (planFor/normalizePlanKey).
 * سقفِ IP از منبعِ حقیقتِ Foundation (workerIpLimitFor) می‌آید — این فایل آن را نمی‌سازد.
 */
export function planFleetCapability(plan: Plan | string): PlanFleetCapability {
  const planKey = normalizePlanKey(plan);
  const workerIpLimit = workerIpLimitFor(plan);
  return {
    planKey,
    planLabelFa: planFor(plan).labelFa,
    workerIpLimit,
    hasWorkerAutoApply: workerIpLimit > 0,
  };
}

/**
 * متنِ کاربرپسندِ «N IPِ ورکر» برای پنلِ premium — null اگر پلن ورکر نداشته باشد.
 * عدد لاتین می‌ماند تا یک‌جا با toFaDigits فارسی شود.
 */
export function workerIpCapacityLabel(workerIpLimit: number): string | null {
  if (workerIpLimit <= 0) return null;
  return `${workerIpLimit} سرورِ اپلای`;
}

/* ──────────────────────────  سلامتِ نود (ادمین)  ────────────────────────── */

/** برچسب + لحن + آیکنِ هر وضعیتِ سلامتِ نود (worker_health). */
export const NODE_HEALTH_LABELS: Record<string, { label: string; tone: Tone; icon: string }> = {
  online: { label: "آنلاین", tone: "green", icon: "🟢" },
  degraded: { label: "نیمه‌فعال", tone: "amber", icon: "🟡" },
  offline: { label: "آفلاین", tone: "rose", icon: "⚪" },
};

/** برچسبِ فارسیِ سلامتِ نود (با fallbackِ امن برای مقدارِ ناشناخته). */
export function nodeHealthLabel(health: string): { label: string; tone: Tone; icon: string } {
  return NODE_HEALTH_LABELS[health] ?? { label: health, tone: "muted", icon: "•" };
}

/* ────────────────────────  فاصله‌ی زمانیِ «چند پیش»  ───────────────────── */

/**
 * فاصله‌ی زمانیِ نسبیِ فارسی از `from` تا اکنون (نمایشی، نه دقیق).
 *   • null → «هیچ‌گاه»
 *   • < ۱ دقیقه → «همین حالا»
 *   • سپس: «X دقیقه/ساعت/روز پیش»
 * عدد لاتین می‌ماند تا یک‌جا با toFaDigits فارسی شود.
 */
export function relativeTimeFa(from: Date | string | null, now: number = Date.now()): string {
  if (from === null) return "هیچ‌گاه";
  const t = typeof from === "string" ? Date.parse(from) : from.getTime();
  if (Number.isNaN(t)) return "—";

  const diffSec = Math.max(0, Math.floor((now - t) / 1000));
  if (diffSec < 60) return "همین حالا";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} دقیقه پیش`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ساعت پیش`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} روز پیش`;
}

/**
 * آیا نود «مرده» به‌نظر می‌رسد؟ (آخرین دیده‌شدن قدیمی‌تر از آستانه — پیش‌فرض ۲ دقیقه).
 * مستقل از فیلدِ health است: نودی که heartbeat نمی‌فرستد، فارغ از سلامتِ ثبت‌شده مرده است.
 */
export function isNodeStale(
  lastSeenAt: Date | string | null,
  now: number = Date.now(),
  thresholdMs: number = 2 * 60 * 1000,
): boolean {
  if (lastSeenAt === null) return true;
  const t = typeof lastSeenAt === "string" ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  if (Number.isNaN(t)) return true;
  return now - t > thresholdMs;
}

/* ────────────────────────  تازگیِ نشستِ خزانه (کاربر)  ──────────────────── */

/** خلاصه‌ی تازگیِ نشستِ خزانه برای نمایش در پنلِ premium. */
export interface SessionFreshness {
  /** آیا دستِ‌کم یک سایتِ متصل با نشستِ تازه (نه stale) وجود دارد؟ */
  anyFresh: boolean;
  /** تعدادِ سایت‌هایی که نشست‌شان stale است (نبود/منقضی). */
  staleCount: number;
  /** تعدادِ کلِ سایت‌های متصل. */
  total: number;
}

/** ورودیِ کمینه‌ای که برای محاسبه‌ی تازگی لازم است (زیرمجموعه‌ی /api/session/status). */
export interface SessionStatusLike {
  stale: boolean;
}

/** از فهرستِ وضعیتِ نشست‌ها (مثلِ خروجیِ /api/session/status) خلاصه‌ی تازگی می‌سازد. */
export function summarizeSessionFreshness(boards: SessionStatusLike[]): SessionFreshness {
  const total = boards.length;
  const staleCount = boards.filter((b) => b.stale).length;
  return {
    anyFresh: total > 0 && staleCount < total,
    staleCount,
    total,
  };
}

/* ─────────────────────────  قالبِ امنِ نسخه/شناسه  ──────────────────────── */

/** نسخه‌ی عاملِ نود را برای نمایش امن می‌کند (null/خالی → «نامشخص»). */
export function agentVersionLabel(version: string | null | undefined): string {
  const v = version?.trim();
  return v && v.length > 0 ? v : "نامشخص";
}

/** کلیدِ نود را برای نمایش کوتاه می‌کند (۸ کاراکترِ اول… برای فهرستِ فشرده). */
export function shortNodeKey(nodeKey: string): string {
  if (nodeKey.length <= 12) return nodeKey;
  return `${nodeKey.slice(0, 8)}…`;
}
