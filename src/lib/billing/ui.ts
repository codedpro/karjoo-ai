/**
 * کمک‌کننده‌های UIِ بیلینگ — *خالص و سمتِ‌کلاینت‌-امن* (Track C: گیتینگ + UXِ هزینه).
 *
 * این فایل عمداً «server-only» نیست و هیچ I/O / رازی ندارد: فقط محاسبه و قالب‌بندیِ
 * خالص است تا هم در RSC، هم در client component و هم در تستِ واحد بدونِ اصطکاک استفاده
 * شود. هیچ‌چیز از این لایه مترِ واقعی نمی‌کند یا هزینه‌ی واقعی کسر نمی‌کند — آن کار
 * متعلق به هسته‌ی Foundation (metering/entitlement) است. اینجا فقط:
 *   • قالب‌بندیِ تومان با ارقامِ فارسی،
 *   • «تخمینِ پیش از کنش» هزینه = توکنِ تخمینی × قیمتِ کاتالوگ × (۱+حاشیه)،
 *   • تشخیص/پارسِ پاسخِ ۴۰۲ (نیازمندِ شارژ) تا UI بتواند پرامپتِ شارژ را نشان دهد.
 *
 * چرا «خالص و ورودی‌محور»؟ قیمتِ مدل از کاتالوگِ سرور می‌آید؛ این لایه آن را به‌عنوانِ
 * ورودی می‌گیرد تا به DB وابسته نباشد و در مرورگر هم قابلِ اجرا بماند.
 */

/* ─────────────────────────────  ارقام و تومان  ──────────────────────────── */

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** ارقامِ لاتین در یک رشته را به فارسی نگاشت می‌کند (هم‌رفتار با dashboard/ui#toFaDigits). */
export function toFaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/**
 * یک مبلغِ تومان (عددِ صحیح) را با جداکننده‌ی هزارگان و ارقامِ فارسی قالب می‌کند.
 * مثال: 12500 → «۱۲٬۵۰۰ تومان». ورودیِ غیرعدد/منفی به‌صورتِ محتاطانه ۰ می‌شود.
 */
export function formatToman(amount: number, opts: { withUnit?: boolean } = {}): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  // جداکننده‌ی هزارگانِ فارسی «٬» (نه کامای لاتین) تا خروجی کاملاً بومی باشد.
  const grouped = toFaDigits(safe.toLocaleString("en-US")).replace(/,/g, "٬");
  return opts.withUnit === false ? grouped : `${grouped} تومان`;
}

/* ─────────────────────────────  تخمینِ هزینه  ──────────────────────────── */

/**
 * قیمتِ یک مدل برای محاسبه‌ی تخمینِ سمتِ‌کلاینت — هم‌شکل با ModelPrice سرور اما بدونِ
 * وابستگیِ سرور. قیمت‌ها «به‌ازای هر ۱۰۰۰ توکن، به تومان»‌اند.
 */
export interface UiModelPrice {
  modelId: string;
  displayName?: string;
  inputPer1kToman: number;
  outputPer1kToman: number;
}

/** تخمینِ توکنِ یک کنشِ پولی — ورودی/خروجیِ معمولِ آن کنش. */
export interface TokenEstimate {
  promptTokens: number;
  completionTokens: number;
}

/**
 * تخمینِ توکنِ پیش‌فرضِ هر کنشِ پولی (CONTEXT — سه کنشِ پولی):
 *   • match        — امتیازدهی/تطبیقِ یک آگهی با پروفایل (پرامپتِ متوسط، خروجیِ کوتاه).
 *   • cover_letter — نگارشِ انگیزه‌نامه (پرامپتِ متوسط، خروجیِ بلندتر).
 *   • resume_parse — استخراجِ فیلدهای ساخت‌یافته از متنِ رزومه (پرامپتِ بلند، خروجیِ JSON متوسط).
 * این‌ها تخمینِ «نمایشی» برای پیش‌نمایشِ هزینه‌اند؛ هزینه‌ی واقعی پس از فراخوانی از
 * usageِ واقعیِ گیت‌وی محاسبه و کسر می‌شود (metering هسته). تخمین معمولاً کمی بالاتر
 * گرفته می‌شود تا «شگفتیِ بدِ» کسرِ بیشتر از تخمین رخ ندهد.
 */
export const ACTION_TOKEN_ESTIMATES = {
  match: { promptTokens: 1200, completionTokens: 250 },
  cover_letter: { promptTokens: 1400, completionTokens: 600 },
  resume_parse: { promptTokens: 2500, completionTokens: 500 },
} as const satisfies Record<string, TokenEstimate>;

export type PaidActionKind = keyof typeof ACTION_TOKEN_ESTIMATES;

/** برچسبِ فارسیِ هر کنشِ پولی — برای نمایش در پرامپتِ هزینه. */
export const PAID_ACTION_LABELS: Record<PaidActionKind, string> = {
  match: "تطبیقِ هوشمندِ آگهی",
  cover_letter: "نگارشِ انگیزه‌نامه",
  resume_parse: "استخراجِ فیلدهای رزومه",
};

/** نتیجه‌ی تخمینِ هزینه‌ی یک کنش — هزینه‌ی نهاییِ کاربر (با حاشیه) و اجزای آن. */
export interface CostEstimate {
  modelId: string;
  displayName: string;
  promptTokens: number;
  completionTokens: number;
  /** هزینه‌ی بالادست (پیش از حاشیه)، به تومان (گرد). */
  upstreamToman: number;
  /** هزینه‌ی نهاییِ تخمینیِ کاربر = upstream × (۱+حاشیه)، به تومان (گرد). */
  costToman: number;
  marginPct: number;
}

/**
 * تخمینِ هزینه‌ی یک کنش را از قیمتِ مدل + توکنِ تخمینی + حاشیه محاسبه می‌کند (خالص).
 *
 * منطقِ محاسبه عمداً *هم‌سان* با Foundation#computeCostFromPrice است (قیمتِ هر ۱۰۰۰
 * توکن، تقسیمِ شناور بر ۱۰۰۰، گرد در پایان) تا تخمینِ UI با کسرِ واقعی هم‌خوان بماند.
 * این یک کپیِ کوچک و خالص است (نه importِ ماژولِ server-only) تا در مرورگر اجرا شود.
 */
export function estimateCost(
  price: UiModelPrice,
  estimate: TokenEstimate,
  marginPct: number,
): CostEstimate {
  const prompt = Math.max(0, estimate.promptTokens || 0);
  const completion = Math.max(0, estimate.completionTokens || 0);
  const margin = Math.max(0, marginPct || 0);
  const input = Math.max(0, price.inputPer1kToman || 0);
  const output = Math.max(0, price.outputPer1kToman || 0);

  const upstreamRaw = (prompt * input + completion * output) / 1000;
  const upstreamToman = Math.round(upstreamRaw);
  const costToman = Math.round(upstreamRaw * (1 + margin / 100));

  return {
    modelId: price.modelId,
    displayName: price.displayName ?? price.modelId,
    promptTokens: prompt,
    completionTokens: completion,
    upstreamToman,
    costToman,
    marginPct: margin,
  };
}

/** تخمینِ هزینه‌ی یک کنشِ پولیِ شناخته‌شده با توکنِ پیش‌فرضِ همان کنش. */
export function estimateActionCost(
  action: PaidActionKind,
  price: UiModelPrice,
  marginPct: number,
): CostEstimate {
  return estimateCost(price, ACTION_TOKEN_ESTIMATES[action], marginPct);
}

/**
 * متنِ کوتاهِ «حدودِ هزینه» برای نمایش کنارِ دکمه‌ی کنشِ پولی.
 * مثال: «حدودِ ۱٬۲۰۰ تومان». «حدود» چون تخمین است نه مبلغِ قطعی.
 */
export function formatCostHint(estimate: CostEstimate): string {
  return `حدودِ ${formatToman(estimate.costToman)}`;
}

/* ───────────────────────────  تشخیصِ نیاز به شارژ  ──────────────────────── */

/**
 * شکلِ پاسخِ ۴۰۲ که فراخواننده می‌تواند رویش تصمیم بگیرد. روت‌های Foundation هنگامِ
 * InsufficientBalanceError یک ۴۰۲ با بدنه‌ی `{ error }` برمی‌گردانند؛ این تابع آن را
 * به یک پرچمِ «نیازمندِ شارژ» + پیام نگاشت می‌کند تا UI پرامپتِ شارژ را نشان دهد.
 */
export interface TopupNeeded {
  needsTopup: true;
  message: string;
}

/** پیامِ پیش‌فرضِ «نیازمندِ شارژ» (هم‌خوان با پیامِ Foundation). */
export const TOPUP_NEEDED_MESSAGE =
  "موجودیِ کیف‌پولِ شما برای استفاده از سرویسِ هوش مصنوعی کافی نیست. لطفاً کیف‌پول را شارژ کنید.";

/**
 * تشخیص می‌دهد آیا یک پاسخِ HTTP «نیازمندِ شارژ» (۴۰۲) است.
 *
 * @param status کدِ وضعیتِ HTTP پاسخ.
 * @param body بدنه‌ی پارس‌شده‌ی پاسخ (ممکن است `{ error }` باشد یا چیزِ دیگر).
 * @returns یک TopupNeeded اگر ۴۰۲ بود، وگرنه null. (فقط ۴۰۲ → شارژ؛ سایرِ خطاها نه.)
 */
export function detectTopupNeeded(
  status: number,
  body: unknown,
): TopupNeeded | null {
  if (status !== 402) return null;
  const message =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? ((body as { error: string }).error)
      : TOPUP_NEEDED_MESSAGE;
  return { needsTopup: true, message };
}

/**
 * یک پاسخِ fetch را به یک نتیجه‌ی نوع‌دارِ ساده تبدیل می‌کند تا فراخواننده‌ی client
 * بتواند سه حالت را تمیز هندل کند: موفق / نیازمندِ شارژ / خطای دیگر.
 *
 * هیچ throwـی نمی‌کند؛ بدنه را با تحملِ خطا می‌خواند.
 */
export interface PaidActionResult<T> {
  ok: boolean;
  status: number;
  /** در صورتِ موفقیت، بدنه‌ی پارس‌شده. */
  data?: T;
  /** اگر ۴۰۲ بود، پرامپتِ شارژ. */
  topup?: TopupNeeded;
  /** پیامِ خطای کاربری برای حالت‌های غیر-۴۰۲ (یا fallback). */
  error?: string;
}

export async function readPaidActionResponse<T = unknown>(
  res: Response,
): Promise<PaidActionResult<T>> {
  const body: unknown = await res.json().catch(() => null);

  if (res.ok) {
    return { ok: true, status: res.status, data: (body ?? undefined) as T | undefined };
  }

  const topup = detectTopupNeeded(res.status, body);
  if (topup) {
    return { ok: false, status: res.status, topup, error: topup.message };
  }

  const error =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "درخواست ناموفق بود.";
  return { ok: false, status: res.status, error };
}
