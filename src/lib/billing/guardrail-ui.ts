/**
 * کمک‌کننده‌های UIِ گاردریل‌های ایمنی (WF3 Track B) — *خالص و سمتِ‌کلاینت‌-امن*.
 *
 * این فایل عمداً «server-only» نیست و هیچ I/O / رازی ندارد: فقط قالب‌بندی و نگاشتِ
 * «وضعیتِ پاسخِ سرور → حالتِ UI» است تا هم در RSC، هم در client component و هم در تستِ
 * واحد بدونِ اصطکاک استفاده شود. دو گاردریلِ Track B را پوشش می‌دهد:
 *
 *   • «حالتِ نگه‌داریِ هوش مصنوعی» (سقفِ بودجه‌ی ماهانه یا پرچمِ دستی) — هر کنشِ پولیِ AI
 *     با ۵۰۳ + پیامِ فارسی بلاک می‌شود؛ UI باید بنرِ نگه‌داری نشان دهد و دکمه‌های AI را
 *     غیرفعال کند.
 *   • «سقفِ اپلای روزانه‌ی پلنِ free» (۱۰۰/روز) — ثبتِ اپلای با ۴۲۹ بلاک می‌شود؛ UI باید
 *     «X / ۱۰۰ درخواست امروز» را نشان دهد و پیامِ سقف را برساند.
 *
 * هیچ‌جا مبلغِ خامِ دلاریِ بودجه فاش نمی‌شود (آن فقط سمتِ سرور است)؛ این لایه فقط با
 * boolean/reason کار می‌کند.
 */

/* ─────────────────────────────  وضعیتِ نگه‌داریِ AI  ─────────────────────── */

/** علتِ نگه‌داری که به کاربر/UI نشان داده می‌شود (بدونِ نشتِ رقمِ بودجه). */
export type MaintenanceReason = "cap" | "manual";

/**
 * شکلِ پاسخِ GET /api/ai-status — همان چیزی که UI برای تصمیم‌گیری مصرف می‌کند.
 * عمداً مینیمال: فقط آیا نگه‌داری فعال است و (در صورتِ فعال) به چه علت.
 */
export interface AiStatus {
  maintenance: boolean;
  /** null وقتی نگه‌داری فعال نیست؛ وگرنه علتِ آن. */
  reason: MaintenanceReason | null;
}

/** وضعیتِ پیش‌فرضِ امن: سرویس در دسترس است (هیچ بلاکی). */
export const AI_STATUS_AVAILABLE: AiStatus = { maintenance: false, reason: null };

/** پیامِ استانداردِ فارسیِ «نگه‌داری» — هم‌خوان با AiMaintenanceError سرور (CONTEXT بخش A). */
export const AI_MAINTENANCE_MESSAGE =
  "سرویس هوش مصنوعی موقتاً در دسترس نیست (سقف ماهانه).";

/** پیامِ نگه‌داریِ دستی — وقتی ادمین سرویس را موقتاً خاموش کرده است. */
export const AI_MAINTENANCE_MANUAL_MESSAGE =
  "سرویس هوش مصنوعی موقتاً برای نگه‌داری در دسترس نیست. لطفاً بعداً تلاش کنید.";

/**
 * شکلِ یک پاسخِ HTTP که این لایه می‌تواند نگاشت کند — کدِ وضعیت + بدنه‌ی پارس‌شده.
 * بدنه ممکن است `{ error, code, reason }` باشد یا چیزِ دیگر؛ با تحملِ خطا خوانده می‌شود.
 */
export interface MappableBody {
  error?: unknown;
  code?: unknown;
  reason?: unknown;
}

/**
 * یک رشته‌ی reason خام (از بدنه‌ی پاسخ) را به MaintenanceReasonِ معتبر نرمال می‌کند.
 * هر چیزِ ناشناخته → 'cap' (محتاطانه: علتِ پیش‌فرض، رقمِ بودجه را فاش نمی‌کند).
 */
export function normalizeMaintenanceReason(raw: unknown): MaintenanceReason {
  return raw === "manual" ? "manual" : "cap";
}

/**
 * تشخیص می‌دهد آیا یک پاسخِ HTTP «نگه‌داریِ هوش مصنوعی» (۵۰۳ + code=ai_maintenance) است.
 *
 * فقط ۵۰۳ـهایی که صراحتاً کدِ `ai_maintenance` دارند نگه‌داری شمرده می‌شوند تا یک ۵۰۳
 * عمومیِ دیگر (مثلاً «گیت‌وی پیکربندی نشده») به‌اشتباه بنرِ نگه‌داری را روشن نکند.
 *
 * @returns یک AiStatus در حالتِ نگه‌داری اگر تطبیق داشت، وگرنه null.
 */
export function detectMaintenance(status: number, body: unknown): AiStatus | null {
  if (status !== 503) return null;
  const b = (body ?? {}) as MappableBody;
  if (b.code !== "ai_maintenance") return null;
  return { maintenance: true, reason: normalizeMaintenanceReason(b.reason) };
}

/** پیامِ کاربریِ متناسب با علتِ نگه‌داری (دستی در برابرِ سقفِ بودجه). */
export function maintenanceMessage(reason: MaintenanceReason | null): string {
  return reason === "manual" ? AI_MAINTENANCE_MANUAL_MESSAGE : AI_MAINTENANCE_MESSAGE;
}

/**
 * پاسخِ GET /api/ai-status را به یک AiStatusِ مطمئن نرمال می‌کند (هرگز throw نمی‌کند).
 * در صورتِ هر بدشکلی/خطای شبکه، «در دسترس» فرض می‌شود تا یک خطای موقتیِ شبکه کلِ
 * UIِ AI را قفل نکند (fail-open برای *نمایش*؛ گیتِ واقعی همیشه سمتِ سرور است).
 */
export function parseAiStatus(body: unknown): AiStatus {
  if (!body || typeof body !== "object") return AI_STATUS_AVAILABLE;
  const b = body as { maintenance?: unknown; reason?: unknown };
  if (b.maintenance !== true) return AI_STATUS_AVAILABLE;
  return { maintenance: true, reason: normalizeMaintenanceReason(b.reason) };
}

/* ─────────────────────────────  سهمیه‌ی اپلای روزانه  ───────────────────── */

/**
 * وضعیتِ سهمیه‌ی اپلای روزانه برای نمایش در UI. برای پلنِ پولی (نامحدود)، limit=null.
 * این شکل هم از پاسخِ /api/me/plan می‌آید و هم از نگاشتِ خطای ۴۲۹.
 */
export interface ApplyQuotaView {
  /** سقفِ روزانه — null برای نامحدود (پلن‌های پولی). */
  limit: number | null;
  usedToday: number;
  /** باقی‌مانده — null اگر نامحدود؛ هرگز منفی نمی‌شود. */
  remaining: number | null;
  /** آیا سقف پر شده (فقط برای پلنِ محدود معنا دارد). */
  reached: boolean;
}

/** پیامِ استانداردِ فارسیِ «سقفِ روزانه‌ی اپلای» — هم‌خوان با CONTEXT بخش D. */
export const APPLY_QUOTA_MESSAGE = "سقف روزانه‌ی ۱۰۰ درخواست (نسخه رایگان)";

/**
 * یک نمای سهمیه از سقف + مصرفِ امروز می‌سازد (خالص). برای نامحدود (limit=null)، فقط
 * usedToday را نگه می‌دارد و reached همیشه false است.
 */
export function buildApplyQuotaView(
  usedToday: number,
  limit: number | null,
): ApplyQuotaView {
  const used = Math.max(0, Math.floor(usedToday || 0));
  if (limit === null || !(limit > 0)) {
    return { limit: null, usedToday: used, remaining: null, reached: false };
  }
  const cap = Math.floor(limit);
  const remaining = Math.max(0, cap - used);
  return { limit: cap, usedToday: used, remaining, reached: used >= cap };
}

/**
 * تشخیص می‌دهد آیا یک پاسخِ HTTP «سقفِ اپلای روزانه» (۴۲۹ + code=apply_quota_exceeded)
 * است. در صورتِ تطبیق، نمای سهمیه‌ی پرشده را برمی‌گرداند (با اعداد اگر بدنه داشته باشد).
 */
export function detectApplyQuotaExceeded(
  status: number,
  body: unknown,
): ApplyQuotaView | null {
  if (status !== 429) return null;
  const b = (body ?? {}) as MappableBody & { usedToday?: unknown; limit?: unknown };
  if (b.code !== "apply_quota_exceeded") return null;
  const limit = typeof b.limit === "number" ? b.limit : 100;
  const usedToday = typeof b.usedToday === "number" ? b.usedToday : limit;
  return buildApplyQuotaView(usedToday, limit);
}

/* ─────────────────────────────  قالب‌بندیِ نمایشی  ──────────────────────── */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** ارقامِ لاتین در یک رشته را به فارسی نگاشت می‌کند (هم‌رفتار با dashboard/ui#toFaDigits). */
function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/**
 * متنِ «X / ۱۰۰ درخواست امروز» برای کاربرِ free — با ارقامِ فارسی.
 * برای پلنِ نامحدود (limit=null) متنِ «اپلای نامحدود» برمی‌گرداند.
 */
export function formatApplyQuota(view: ApplyQuotaView): string {
  if (view.limit === null) return "اپلای نامحدود";
  return `${toFaDigits(view.usedToday)} / ${toFaDigits(view.limit)} درخواست امروز`;
}
