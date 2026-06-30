import "server-only";

/**
 * بارگذار متغیرهای محیطی کنترل‌پلین کارجو (server-only).
 *
 * فلسفه‌ی طراحی:
 *   • DATABASE_URL برای بوت اپ لازم است؛ نبودش خطای فوری می‌دهد.
 *   • متغیرهای 1xai «اختیاری اما با خطای روشن هنگام استفاده» هستند: اپ بدون آن‌ها
 *     بالا می‌آید (لندینگ/بلاگ کار می‌کنند)، ولی اولین فراخوانی هوش مصنوعی که کلید
 *     نداشته باشد، پیامی واضح می‌دهد به‌جای یک خطای مبهم از کلاینت پایین‌دستی.
 *
 * هرگز این ماژول را به باندل کلاینت نشت ندهید — به همین خاطر "server-only".
 */
import { z } from "zod";

/**
 * متغیرِ اختیاری: «رشته‌ی خالی» را هم‌معنا با «تنظیم‌نشده» (undefined) می‌گیریم.
 *
 * چرا؟ .env.example متغیرهای اختیاری (ONEXAI_*، INTERNAL_API_SECRET) را با مقدارِ
 * خالی (`ONEXAI_MODEL=`) منتشر می‌کند. اگر توسعه‌دهنده آن را به .env.local کپی کند،
 * این کلیدها «حاضر اما خالی» می‌شوند و .optional() آن‌ها را نجات نمی‌دهد (رشته‌ی خالی
 * «غایب» نیست؛ «نامعتبر» است). با preprocess، خالی → undefined می‌شود تا قولِ طراحی
 * («اپ بدون این‌ها بالا می‌آید») واقعاً برقرار بماند. این کارِ قبلیِ setup-env تست را
 * هم در سطحِ منبعِ حقیقت (env.ts) رسمی می‌کند.
 */
const optionalNonEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

/** اسکیمای پایه‌ی محیط؛ متغیرهای هوش مصنوعی عمداً اختیاری‌اند. */
const envSchema = z.object({
  // پایگاه‌داده‌ی کنترل‌پلین. برای هر کاری با دیتابیس لازم است.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL لازم است (نمونه: postgres://karjoo:karjoo@localhost:5432/karjoo)"),

  // گیت‌وی 1xai (سازگار با OpenAI). اختیاری در بوت، اجباری هنگام فراخوانی مدل.
  // رشته‌ی خالی ⇒ تنظیم‌نشده (تا کپیِ .env.example بوت را نشکند).
  ONEXAI_BASE_URL: optionalNonEmpty(z.string().url()),
  ONEXAI_API_KEY: optionalNonEmpty(z.string().min(1)),
  ONEXAI_MODEL: optionalNonEmpty(z.string().min(1)),

  // راز مشترکِ مسیرهای «داخلی» (مثل /api/internal/ingest). احراز هویت واقعی بعداً
  // می‌آید؛ تا آن زمان این هدر «X-Internal-Secret» جلوی فراخوانی بیرونی را می‌گیرد.
  // مثل ONEXAI: اختیاری در بوت (تا لندینگ/بلاگ بدون آن بالا بیایند) ولی اجباری
  // هنگام استفاده — requireInternalSecret() اگر تنظیم نشده باشد fail-closed می‌کند.
  INTERNAL_API_SECRET: optionalNonEmpty(z.string().min(1)),

  // ── احراز هویت (auth) ────────────────────────────────────────────────────
  // رازِ سرور برای هش‌کردنِ OTPها و توکن‌های نشست (HMAC pepper). هرگز به کلاینت
  // نشت نمی‌کند و هرگز در دیتابیس ذخیره نمی‌شود؛ فقط برای محاسبه‌ی هش استفاده می‌شود.
  // اختیاری در بوت (تا لندینگ/بلاگ بدون آن بالا بیایند) ولی اجباری هنگام صدور/راستی‌آزماییِ
  // هر OTP یا نشست — requireAuthPepper() اگر تنظیم نشده باشد fail-closed می‌کند.
  // حداقل ۱۶ کاراکتر تا entropy کافی داشته باشد.
  AUTH_TOKEN_PEPPER: optionalNonEmpty(z.string().min(16)),

  // ── ارائه‌دهنده‌ی پیامک (SMS — برای ارسال OTP) ───────────────────────────
  // همه اختیاری‌اند: اگر هیچ‌کدام تنظیم نشده باشد، sendOtpSms در حالت توسعه کد را
  // در کنسول لاگ می‌کند (به‌جای ارسال واقعی) و یک نشانه‌ی "dev_mode" برمی‌گرداند —
  // پس اپ بدون هیچ providerِ واقعی هم بوت و کار می‌کند (قاعده‌ی ۶ بخش CONTEXT).
  // ترجیح با Kavenegar (ارائه‌دهنده‌ی ایرانی)؛ در نبودش از SMS_API_KEY عمومی استفاده می‌شود.
  KAVENEGAR_API_KEY: optionalNonEmpty(z.string().min(1)),
  /** نام الگوی (template) لوکاپِ Kavenegar برای ارسال OTP (verify lookup). */
  KAVENEGAR_TEMPLATE: optionalNonEmpty(z.string().min(1)),
  /** کلیدِ عمومیِ ارائه‌دهنده‌ی پیامک (در صورت استفاده از providerِ دیگر مثل SMS.ir). */
  SMS_API_KEY: optionalNonEmpty(z.string().min(1)),
  /** شماره/شناسه‌ی فرستنده‌ی پیامک (برای providerِ عمومی). */
  SMS_SENDER: optionalNonEmpty(z.string().min(1)),

  // ── ذخیره‌سازیِ فایلِ آپلود (WF1 — رزومه‌ی PDF) ───────────────────────────
  // پوشه‌ی پایه‌ی ذخیره‌ی فایلِ خامِ رزومه روی دیسکِ محلی. اختیاری: اگر تنظیم نشود،
  // پیش‌فرض `./uploads` در ریشه‌ی پروژه (در .gitignore) استفاده می‌شود. مسیرِ مطلق
  // یا نسبی هر دو پذیرفته می‌شود (نسبی نسبت به cwd حل می‌شود).
  KARJOO_UPLOADS_DIR: optionalNonEmpty(z.string().min(1)),

  // ── حاشیه‌ی سودِ کارجو روی فراخوانیِ پولیِ هوش مصنوعی (billing) ─────────────
  // درصدِ سودِ کارجو روی قیمتِ بالادستِ 1xai. هزینه‌ی نهاییِ کاربر:
  //   costToman = upstreamCostToman × (۱ + KARJOO_AI_MARGIN_PCT/۱۰۰).
  // اختیاری؛ اگر تنظیم نشود پیش‌فرضِ ۲۰٪ استفاده می‌شود (resolveMarginPct()).
  // عددِ صحیحِ نامنفی (رشته‌ی محیط به عدد coerce می‌شود).
  KARJOO_AI_MARGIN_PCT: optionalNonEmpty(z.coerce.number().int().min(0)),

  // ── گاردریلِ بودجه‌ی ماهانه‌ی هوش مصنوعی (WF3 — محافظِ هزینه‌ی واقعیِ بالادست) ──
  // سقفِ ماهانه به دلار: جمعِ هزینه‌ی بالادستِ هوش مصنوعیِ کلِ اپ که اگر از آن بگذرد،
  // حالتِ نگه‌داری (maintenance) فعال و هر فراخوانیِ پولی بلاک می‌شود. اختیاری؛ پیش‌فرض ۳۰.
  KARJOO_AI_MONTHLY_BUDGET_USD: optionalNonEmpty(z.coerce.number().min(0)),
  // نرخِ تبدیلِ دلار به تومان برای محاسبه‌ی سقفِ ماهانه (cap به تومان). اختیاری؛ پیش‌فرض ۷۰۰۰۰.
  KARJOO_USD_TO_TOMAN: optionalNonEmpty(z.coerce.number().min(0)),

  // ── محدودیت‌های سختِ هر فراخوانی (WF3 — جلوگیری از حلقه/فراریِ هزینه) ──────
  // سقفِ پیش‌فرضِ توکنِ خروجی برای هر فراخوانیِ مدل (اگر فراخواننده خودش نداده باشد).
  // اختیاری؛ پیش‌فرض ۱۲۰۰. عددِ صحیحِ مثبت.
  KARJOO_AI_MAX_OUTPUT_TOKENS: optionalNonEmpty(z.coerce.number().int().positive()),
  // تایم‌اوتِ هر درخواستِ گیت‌وی به میلی‌ثانیه (AbortController). اختیاری؛ پیش‌فرض ۶۰۰۰۰.
  KARJOO_AI_TIMEOUT_MS: optionalNonEmpty(z.coerce.number().int().positive()),
  // سقفِ تعدادِ آگهیِ پردازش‌شده در هر اجرای ارکستریتور (جلوگیری از fan-outِ نامحدودِ
  // فراخوانیِ مدل در یک اجرا). اختیاری؛ پیش‌فرض ۲۵. عددِ صحیحِ مثبت.
  KARJOO_ORCHESTRATOR_RUN_CAP: optionalNonEmpty(z.coerce.number().int().positive()),
});

/** درصدِ پیش‌فرضِ حاشیه‌ی سود اگر KARJOO_AI_MARGIN_PCT تنظیم نشده باشد. */
export const DEFAULT_AI_MARGIN_PCT = 20;

/* ─────────────  پیش‌فرض‌های گاردریلِ ایمنی (WF3)  ────────────────────────── */

/** سقفِ ماهانه‌ی هوش مصنوعی به دلار اگر env تنظیم نشده باشد. */
export const DEFAULT_AI_MONTHLY_BUDGET_USD = 30;
/** نرخِ پیش‌فرضِ تبدیلِ دلار به تومان اگر env تنظیم نشده باشد. */
export const DEFAULT_USD_TO_TOMAN = 70_000;
/** سقفِ پیش‌فرضِ توکنِ خروجی برای هر فراخوانیِ مدل. */
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 1200;
/** تایم‌اوتِ پیش‌فرضِ هر درخواستِ گیت‌وی به میلی‌ثانیه. */
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
/** سقفِ پیش‌فرضِ تعدادِ آگهیِ پردازش‌شده در هر اجرای ارکستریتور. */
export const DEFAULT_ORCHESTRATOR_RUN_CAP = 25;

type Env = z.infer<typeof envSchema>;

/**
 * اعتبارسنجی یک‌باره. اگر DATABASE_URL غایب/نامعتبر باشد همین‌جا با پیام خوانا
 * می‌افتد. متغیرهای اختیاری اگر نباشند، undefined می‌مانند (نه خطا).
 */
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`پیکربندی محیط نامعتبر است:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/**
 * پیکربندی تأییدشده‌ی 1xai. این را در مسیر فراخوانی مدل صدا بزنید (نه در بوت):
 * اگر هر یک از متغیرها تنظیم نشده باشد، خطای روشن می‌دهد تا توسعه‌دهنده بداند
 * دقیقاً کدام متغیر کم است — به‌جای یک ۴۰۱ مبهم از گیت‌وی.
 */
export function requireOneXai(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const missing: string[] = [];
  if (!env.ONEXAI_BASE_URL) missing.push("ONEXAI_BASE_URL");
  if (!env.ONEXAI_API_KEY) missing.push("ONEXAI_API_KEY");
  if (!env.ONEXAI_MODEL) missing.push("ONEXAI_MODEL");

  if (missing.length > 0) {
    throw new Error(
      `سرویس هوش مصنوعی پیکربندی نشده است؛ این متغیرها لازم‌اند: ${missing.join(", ")}. ` +
        "همه‌ی فراخوانی‌های مدل باید از طریق گیت‌وی 1xai انجام شوند.",
    );
  }

  return {
    baseUrl: env.ONEXAI_BASE_URL!,
    apiKey: env.ONEXAI_API_KEY!,
    model: env.ONEXAI_MODEL!,
  };
}

/**
 * رازِ مشترکِ مسیرهای داخلی. این را در نگهبانِ هدرِ مسیرهای /api/internal صدا بزنید.
 * اگر INTERNAL_API_SECRET تنظیم نشده باشد خطا می‌دهد تا مسیر «fail-closed» شود
 * (به‌جای آنکه با رازِ خالی به اشتباه باز بماند).
 */
export function requireInternalSecret(): string {
  if (!env.INTERNAL_API_SECRET) {
    throw new Error(
      "مسیر داخلی غیرفعال است: INTERNAL_API_SECRET تنظیم نشده. " +
        "این متغیر را در محیط ست کنید تا مسیرهای /api/internal فعال شوند.",
    );
  }
  return env.INTERNAL_API_SECRET;
}

/**
 * رازِ pepper برای هش‌کردنِ OTP/توکنِ نشست. این را در مسیرِ صدور یا راستی‌آزماییِ هر
 * OTP/نشست صدا بزنید (نه در بوت). اگر تنظیم نشده باشد fail-closed می‌شود تا هرگز با
 * pepperِ خالی هش‌های ضعیف/قابل‌پیش‌بینی تولید نشود.
 */
export function requireAuthPepper(): string {
  if (!env.AUTH_TOKEN_PEPPER) {
    throw new Error(
      "احراز هویت غیرفعال است: AUTH_TOKEN_PEPPER تنظیم نشده. " +
        "یک رشته‌ی تصادفیِ طولانی (حداقل ۱۶ کاراکتر) ست کنید تا OTP/نشست فعال شوند.",
    );
  }
  return env.AUTH_TOKEN_PEPPER;
}

/**
 * درصدِ حاشیه‌ی سودِ کارجو روی فراخوانیِ پولیِ هوش مصنوعی. هرگز throw نمی‌کند: اگر
 * KARJOO_AI_MARGIN_PCT تنظیم نشده باشد، پیش‌فرضِ DEFAULT_AI_MARGIN_PCT برمی‌گردد.
 * این تابع را در محاسبه‌ی هزینه (src/lib/billing/pricing.ts) صدا بزنید.
 */
export function resolveMarginPct(): number {
  return env.KARJOO_AI_MARGIN_PCT ?? DEFAULT_AI_MARGIN_PCT;
}

/* ─────────────  حل‌کننده‌های گاردریلِ ایمنی (WF3)  ───────────────────────── */

/** سقفِ ماهانه‌ی هوش مصنوعی به دلار (env یا پیش‌فرض ۳۰). هرگز throw نمی‌کند. */
export function aiMonthlyBudgetUsd(): number {
  return env.KARJOO_AI_MONTHLY_BUDGET_USD ?? DEFAULT_AI_MONTHLY_BUDGET_USD;
}

/** نرخِ تبدیلِ دلار به تومان (env یا پیش‌فرض ۷۰۰۰۰). هرگز throw نمی‌کند. */
export function usdToToman(): number {
  return env.KARJOO_USD_TO_TOMAN ?? DEFAULT_USD_TO_TOMAN;
}

/**
 * سقفِ ماهانه‌ی هوش مصنوعی به *تومان* = budgetUsd × usdToToman (گرد به عددِ صحیح).
 * مرجعِ گاردریلِ بودجه (ai-budget.ts isAiInMaintenance این را با جمعِ ماه مقایسه می‌کند).
 */
export function aiMonthlyCapToman(): number {
  return Math.round(aiMonthlyBudgetUsd() * usdToToman());
}

/** سقفِ پیش‌فرضِ توکنِ خروجیِ هر فراخوانیِ مدل (env یا پیش‌فرض ۱۲۰۰). */
export function aiMaxOutputTokens(): number {
  return env.KARJOO_AI_MAX_OUTPUT_TOKENS ?? DEFAULT_AI_MAX_OUTPUT_TOKENS;
}

/** تایم‌اوتِ هر درخواستِ گیت‌وی به میلی‌ثانیه (env یا پیش‌فرض ۶۰۰۰۰). */
export function aiTimeoutMs(): number {
  return env.KARJOO_AI_TIMEOUT_MS ?? DEFAULT_AI_TIMEOUT_MS;
}

/** سقفِ تعدادِ آگهیِ پردازش‌شده در هر اجرای ارکستریتور (env یا پیش‌فرض ۲۵). */
export function orchestratorRunCap(): number {
  return env.KARJOO_ORCHESTRATOR_RUN_CAP ?? DEFAULT_ORCHESTRATOR_RUN_CAP;
}

/** پیکربندیِ حل‌شده‌ی ارائه‌دهنده‌ی پیامک — یکی از Kavenegar یا providerِ عمومی. */
export type SmsConfig =
  | { provider: "kavenegar"; apiKey: string; template?: string }
  | { provider: "generic"; apiKey: string; sender?: string };

/**
 * پیکربندیِ پیامک را برمی‌گرداند، یا null اگر هیچ providerی تنظیم نشده باشد (حالت توسعه).
 * هرگز throw نمی‌کند — صدازننده (sendOtpSms) با null به حالتِ «لاگ در کنسول» می‌رود تا
 * اپ بدون providerِ واقعی هم کار کند. Kavenegar بر providerِ عمومی اولویت دارد.
 */
export function getSmsConfig(): SmsConfig | null {
  if (env.KAVENEGAR_API_KEY) {
    return {
      provider: "kavenegar",
      apiKey: env.KAVENEGAR_API_KEY,
      ...(env.KAVENEGAR_TEMPLATE ? { template: env.KAVENEGAR_TEMPLATE } : {}),
    };
  }
  if (env.SMS_API_KEY) {
    return {
      provider: "generic",
      apiKey: env.SMS_API_KEY,
      ...(env.SMS_SENDER ? { sender: env.SMS_SENDER } : {}),
    };
  }
  return null;
}
