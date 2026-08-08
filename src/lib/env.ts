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

  // ── ورود با Google (OAuth2 Authorization-Code) ───────────────────────────
  // شناسه/رازِ کلاینتِ Google (server-only). مثلِ ONEXAI: اختیاری در بوت (تا لندینگ/بلاگ
  // بدونِ آن‌ها بالا بیایند) ولی اجباری هنگامِ شروعِ جریانِ OAuth یا تبادلِ کد —
  // requireGoogleOAuth() اگر هر کدام تنظیم نشده باشد fail-closed می‌کند. رشته‌ی خالی ⇒
  // تنظیم‌نشده (تا کپیِ .env.example بوت را نشکند). این‌ها را *هرگز لاگ نکنید*.
  GOOGLE_CLIENT_ID: optionalNonEmpty(z.string().min(1)),
  GOOGLE_CLIENT_SECRET: optionalNonEmpty(z.string().min(1)),
  // override اختیاریِ redirect_uri. اگر تنظیم نشود، از NEXT_PUBLIC_SITE_URL مشتق می‌شود:
  // <NEXT_PUBLIC_SITE_URL>/api/auth/google/callback. باید *دقیقاً* با redirect URIِ مجاز
  // روی کلاینتِ Google یکی باشد (https://karjoo.1xai.ir/api/auth/google/callback).
  GOOGLE_REDIRECT_URI: optionalNonEmpty(z.string().url()),

  // ── ارائه‌دهنده‌ی پیامک (SMS — میراثِ OTP، بلااستفاده پس از مهاجرت به Google) ─
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

  // ── اعتبارِ خوش‌آمدِ کاربرِ تازه (owner-approved) ──────────────────────────
  // مبلغِ اعتبارِ هوش مصنوعی (به تومان) که به کیف‌پولِ کاربرِ *تازه* در اولین ورود هدیه
  // می‌شود تا اولین «پردازشِ رزومه با هوش مصنوعی» بدونِ نیاز به شارژ کار کند. فقط هنگامِ
  // *ساختِ* ردیفِ کاربر و به‌صورتِ ایدمپوتنت (refId=signup:<userId>) اعمال می‌شود؛ کاربرانِ
  // موجود بی‌تأثیر می‌مانند. اختیاری؛ اگر تنظیم نشود پیش‌فرضِ ۲۰۰۰۰ تومان. عددِ صحیحِ
  // نامنفی؛ ۰ یعنی «اعتبارِ خوش‌آمد را خاموش کن».
  KARJOO_SIGNUP_CREDIT_TOMAN: optionalNonEmpty(z.coerce.number().int().min(0)),

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

  // ── خزانه‌ی نشست (session vault — Max/Max+ track C، قاعده‌ی ۴) ───────────────
  // کلیدِ AES-256-GCM برای رمزنگاریِ بلابِ نشستِ کاربر در خزانه. یک کلیدِ ۳۲ بایتیِ
  // base64 یا hex. اختیاری در بوت: اگر تنظیم نشده باشد، /api/session/refresh یک خطای
  // روشنِ «پیکربندی‌نشده» می‌دهد و *هرگز* نشستِ خام را ذخیره نمی‌کند (fail-closed).
  // requireVaultKey() اگر کلید کم/نامعتبر باشد VaultNotConfiguredError می‌دهد.
  KARJOO_VAULT_KEY: optionalNonEmpty(z.string().min(1)),

  // ── اپلای خودکار: راهنماییِ زمان‌بندیِ افزونه (advisory) ─────────────────────
  // فاصله‌ی زمانیِ chrome.alarms برای درینِ صفِ اپلایِ خودکار، به دقیقه. اختیاری؛
  // پیش‌فرض ۱۵. این فقط به افزونه «توصیه» می‌شود (در پاسخِ تنظیمات)؛ خودِ سرور با آن
  // کاری نمی‌کند. عددِ صحیحِ مثبت.
  KARJOO_AUTO_APPLY_ALARM_MINUTES: optionalNonEmpty(z.coerce.number().int().positive()),
  // کفِ بازه‌ی jitterِ ادبِ اپلای خودکار، به میلی‌ثانیه (advisory برای افزونه). پیش‌فرض ۲۰۰۰.
  KARJOO_AUTO_APPLY_JITTER_MS_MIN: optionalNonEmpty(z.coerce.number().int().min(0)),
  // سقفِ بازه‌ی jitterِ ادبِ اپلای خودکار، به میلی‌ثانیه (advisory برای افزونه). پیش‌فرض ۸۰۰۰.
  KARJOO_AUTO_APPLY_JITTER_MS_MAX: optionalNonEmpty(z.coerce.number().int().min(0)),

  // ── ناوگانِ اپلای (worker fleet — Max/Max+، قاعده‌های ۱ و ۴) ────────────────
  // رازِ مشترکِ یک‌بارمصرفِ ثبت‌نام که نودها برای enroll ارائه می‌دهند. اختیاری در بوت:
  // اگر تنظیم نشده باشد، ثبت‌نام «بسته» است و enrollNode با خطای روشن (۵۰۳) رد می‌شود —
  // یعنی هیچ نودِ جدیدی نمی‌تواند بدونِ این راز ثبت‌نام کند (fail-closed). حداقل ۱۶ کاراکتر.
  KARJOO_FLEET_ENROLLMENT_TOKEN: optionalNonEmpty(z.string().min(16)),
  // مسیرِ اسکریپتی که نودِ ورکر هنگامِ فرمانِ 'update' اجرا می‌کند (pull+restart،
  // مستقل از روشِ استقرار). فقط advisory است: سرور آن را به نود گزارش می‌کند؛ خودِ
  // سرور چیزی اجرا نمی‌کند. اختیاری؛ پیش‌فرض './update.sh'.
  KARJOO_FLEET_UPDATE_SCRIPT: optionalNonEmpty(z.string().min(1)),

  // ── درگاهِ سرویسِ 1xai (اتحادِ خانواده: یک استخرِ کاربر/کیف‌پول) ────────────────
  // آدرسِ لوپ‌بکِ APIِ داخلیِ 1xai روی همین میزبان + رازِ HMACِ مشترکِ /svc.
  // اختیاری در بوت: اگر تنظیم نشده باشند، لایه‌ی unified «سرویس در دسترس نیست» می‌دهد
  // (fail-closed) و هیچ درخواستی بیرون نمی‌رود. راز hex است (هم‌قراردادِ pay-worker).
  ONEXAI_SVC_URL: optionalNonEmpty(z.string().url()),
  ONEXAI_SVC_SECRET: optionalNonEmpty(z.string().min(32)),

  // ── کارت‌به‌کارت (billing) — شماره‌کارت و نامِ صاحبِ کارتِ مقصد که به کاربر نشان داده
  // می‌شود تا مبلغ را منتقل کند. اختیاری در بوت: اگر تنظیم نشده باشد، فرمِ شارژ «هنوز
  // فعال نیست» را می‌دهد (fail-closed؛ هرگز کارتِ ساختگی نشان داده نمی‌شود). این‌ها را
  // در env تنظیم کنید (نه در کد/گیت)؛ شماره‌کارتِ واقعی هرگز commit نمی‌شود.
  KARJOO_CARD_NUMBER: optionalNonEmpty(z.string().min(1)),
  KARJOO_CARD_HOLDER: optionalNonEmpty(z.string().min(1)),
  KARJOO_CARD_BANK: optionalNonEmpty(z.string().min(1)),
});

/** درصدِ پیش‌فرضِ حاشیه‌ی سود اگر KARJOO_AI_MARGIN_PCT تنظیم نشده باشد. */
export const DEFAULT_AI_MARGIN_PCT = 20;

/** مبلغِ پیش‌فرضِ اعتبارِ خوش‌آمدِ کاربرِ تازه (تومان) اگر env تنظیم نشده باشد. */
export const DEFAULT_SIGNUP_CREDIT_TOMAN = 20_000;

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

/* ─────────────  پیش‌فرض‌های اپلای خودکار (advisory برای افزونه)  ──────────── */

/** فاصله‌ی پیش‌فرضِ chrome.alarms برای درینِ صفِ اپلای خودکار، به دقیقه. */
export const DEFAULT_AUTO_APPLY_ALARM_MINUTES = 15;
/** کفِ پیش‌فرضِ بازه‌ی jitterِ ادبِ اپلای خودکار، به میلی‌ثانیه. */
export const DEFAULT_AUTO_APPLY_JITTER_MS_MIN = 2_000;
/** سقفِ پیش‌فرضِ بازه‌ی jitterِ ادبِ اپلای خودکار، به میلی‌ثانیه. */
export const DEFAULT_AUTO_APPLY_JITTER_MS_MAX = 8_000;

/* ─────────────  پیش‌فرض‌های ناوگانِ اپلای (worker fleet)  ──────────────────── */

/** اسکریپتِ پیش‌فرضِ به‌روزرسانیِ نود (advisory) اگر env تنظیم نشده باشد. */
export const DEFAULT_FLEET_UPDATE_SCRIPT = "./update.sh";

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

/* ─────────────  حل‌کننده‌های ورود با Google (OAuth2)  ─────────────────────── */

/** مسیرِ callbackِ Google — باید *دقیقاً* با redirect URIِ مجازِ کلاینتِ Google یکی باشد. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/** آدرسِ پیش‌فرضِ عمومیِ سایت (برای مشتق‌کردنِ redirect_uri) — هم‌راستا با src/lib/site.ts. */
const DEFAULT_SITE_URL = "https://karjoo.ai";

/**
 * `redirect_uri`ِ جریانِ OAuthِ Google را حل می‌کند.
 *
 * ترتیب: اگر GOOGLE_REDIRECT_URI صریحاً تنظیم شده باشد همان؛ وگرنه از
 * NEXT_PUBLIC_SITE_URL (یا پیش‌فرضِ برند) + GOOGLE_CALLBACK_PATH مشتق می‌شود. این مقدار
 * باید در «شروعِ جریان» و «تبادلِ کد» *یکسان* باشد و *دقیقاً* با redirect URIِ مجاز روی
 * کلاینتِ Google بخورد؛ وگرنه Google با redirect_uri_mismatch رد می‌کند. هرگز throw
 * نمی‌کند (فقط رشته‌ای بی‌راز می‌سازد).
 */
export function resolveGoogleRedirectUri(): string {
  if (env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI;
  const base = (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return `${base}${GOOGLE_CALLBACK_PATH}`;
}

/**
 * اعتبارنامه‌ی تأییدشده‌ی کلاینتِ Google. این را در مسیرِ شروع/تبادلِ OAuth صدا بزنید
 * (نه در بوت): اگر هر یک از GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET تنظیم نشده باشد، خطای
 * روشن می‌دهد تا توسعه‌دهنده بداند کدام متغیر کم است — به‌جای یک ۴۰۰/۴۰۱ مبهم از Google.
 * secret را *هرگز لاگ نکنید*. redirectUri همان‌جا حل و برگردانده می‌شود تا فراخواننده هم
 * شروعِ جریان و هم تبادلِ کد را با «یک» مقدار انجام دهد.
 */
export function requireGoogleOAuth(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `ورود با Google پیکربندی نشده است؛ این متغیرها لازم‌اند: ${missing.join(", ")}. ` +
        "این‌ها را در محیطِ سرور (server-only) ست کنید تا جریانِ OAuth فعال شود.",
    );
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    redirectUri: resolveGoogleRedirectUri(),
  };
}

/** آیا ورود با Google پیکربندی شده است؟ (برای پاسخِ سریعِ «پیکربندی‌نشده» بدونِ throw). */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * درصدِ حاشیه‌ی سودِ کارجو روی فراخوانیِ پولیِ هوش مصنوعی. هرگز throw نمی‌کند: اگر
 * KARJOO_AI_MARGIN_PCT تنظیم نشده باشد، پیش‌فرضِ DEFAULT_AI_MARGIN_PCT برمی‌گردد.
 * این تابع را در محاسبه‌ی هزینه (src/lib/billing/pricing.ts) صدا بزنید.
 */
export function resolveMarginPct(): number {
  return env.KARJOO_AI_MARGIN_PCT ?? DEFAULT_AI_MARGIN_PCT;
}

/**
 * مبلغِ اعتبارِ خوش‌آمدِ کاربرِ تازه به تومان (env یا پیش‌فرضِ ۲۰۰۰۰). هرگز throw نمی‌کند.
 * مقدارِ ۰ یعنی «اعتبارِ خوش‌آمد خاموش است» و findOrCreateUserByGoogle آن را نادیده می‌گیرد.
 * این را فقط هنگامِ ساختِ کاربرِ تازه (auth/http.ts) صدا بزنید.
 */
export function signupCreditToman(): number {
  return env.KARJOO_SIGNUP_CREDIT_TOMAN ?? DEFAULT_SIGNUP_CREDIT_TOMAN;
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

/* ─────────────  حل‌کننده‌های خزانه‌ی نشست + اپلای خودکار  ─────────────────── */

/**
 * کلیدِ خامِ خزانه (KARJOO_VAULT_KEY) را برمی‌گرداند، یا `null` اگر تنظیم نشده باشد.
 *
 * این تابع هرگز throw نمی‌کند و کلید را *رمزگشایی/اعتبارسنجی نمی‌کند*؛ صرفاً مقدارِ خام
 * (یا null) را می‌دهد. اعتبارسنجی (طولِ ۳۲ بایت، base64/hex) و خطای typedِ
 * VaultNotConfiguredError در src/lib/vault/crypto.ts انجام می‌شود — تا env.ts به لایه‌ی
 * رمزنگاری وابسته نشود و «server-only»بودنِ آن لایه حفظ بماند.
 */
export function vaultKeyRaw(): string | null {
  return env.KARJOO_VAULT_KEY ?? null;
}

/** آیا کلیدِ خزانه اصلاً تنظیم شده است؟ (برای پاسخِ سریعِ «پیکربندی‌نشده» بدونِ decode). */
export function isVaultConfigured(): boolean {
  return Boolean(env.KARJOO_VAULT_KEY);
}

/* ─────────────  حل‌کننده‌های ناوگانِ اپلای (worker fleet)  ─────────────────── */

/**
 * رازِ ثبت‌نامِ ناوگان (KARJOO_FLEET_ENROLLMENT_TOKEN) را برمی‌گرداند، یا `null` اگر
 * تنظیم نشده باشد. هرگز throw نمی‌کند. لایه‌ی fleet/enroll اگر null بود، ثبت‌نام را
 * «بسته» می‌گیرد (FleetEnrollmentClosedError → پاسخِ ۵۰۳) — fail-closed: بدونِ این راز
 * هیچ نودی ثبت‌نام نمی‌شود. این مقدار را *لاگ نکنید*.
 */
export function fleetEnrollmentTokenRaw(): string | null {
  return env.KARJOO_FLEET_ENROLLMENT_TOKEN ?? null;
}

/** آیا ثبت‌نامِ ناوگان باز است؟ (آیا رازِ ثبت‌نام تنظیم شده) — برای پاسخِ سریعِ ۵۰۳. */
export function isFleetEnrollmentOpen(): boolean {
  return Boolean(env.KARJOO_FLEET_ENROLLMENT_TOKEN);
}

/** پیکربندیِ درگاهِ سرویسِ 1xai (استخرِ مشترکِ کاربر/کیف‌پول). */
export interface OnexaiSvcConfig {
  /** ریشه‌ی API داخلی، مثلاً http://127.0.0.1:8081 (بدونِ اسلشِ پایانی). */
  baseUrl: string;
  /** رازِ HMAC به‌صورتِ hex (هم‌قراردادِ pay-worker). */
  secretHex: string;
}

/**
 * پیکربندیِ /svcِ 1xai، یا null اگر تنظیم نشده باشد (هر دو متغیر لازم‌اند).
 * هرگز throw نمی‌کند — لایه‌ی unified با null «سرویس در دسترس نیست» می‌دهد.
 */
export function onexaiSvcConfig(): OnexaiSvcConfig | null {
  if (!env.ONEXAI_SVC_URL || !env.ONEXAI_SVC_SECRET) return null;
  return {
    baseUrl: env.ONEXAI_SVC_URL.replace(/\/+$/, ""),
    secretHex: env.ONEXAI_SVC_SECRET,
  };
}

/** اطلاعاتِ کارتِ مقصدِ کارت‌به‌کارت که به کاربر نشان داده می‌شود. */
export interface CardToCardInfo {
  cardNumber: string;
  holder: string;
  bank?: string;
}

/**
 * اطلاعاتِ کارتِ مقصد، یا null اگر تنظیم نشده باشد (شماره‌کارت + نامِ صاحب لازم‌اند).
 * هرگز throw نمی‌کند. لایه‌ی بیلینگ اگر null بود، «شارژ هنوز فعال نیست» می‌دهد — پس هیچ
 * درخواستِ پرداختی بدونِ کارتِ واقعیِ پیکربندی‌شده ساخته نمی‌شود.
 */
export function cardToCardInfo(): CardToCardInfo | null {
  if (!env.KARJOO_CARD_NUMBER || !env.KARJOO_CARD_HOLDER) return null;
  return {
    cardNumber: env.KARJOO_CARD_NUMBER,
    holder: env.KARJOO_CARD_HOLDER,
    ...(env.KARJOO_CARD_BANK ? { bank: env.KARJOO_CARD_BANK } : {}),
  };
}

/**
 * مسیرِ اسکریپتِ به‌روزرسانیِ نود (advisory) — env یا پیش‌فرضِ './update.sh'. هرگز throw
 * نمی‌کند. سرور این را صرفاً در payloadِ فرمانِ 'update' به نود گزارش می‌کند؛ خودش اجرا نمی‌کند.
 */
export function fleetUpdateScript(): string {
  return env.KARJOO_FLEET_UPDATE_SCRIPT ?? DEFAULT_FLEET_UPDATE_SCRIPT;
}

/** فاصله‌ی chrome.alarms اپلای خودکار به دقیقه (env یا پیش‌فرض ۱۵) — advisory. */
export function autoApplyAlarmMinutes(): number {
  return env.KARJOO_AUTO_APPLY_ALARM_MINUTES ?? DEFAULT_AUTO_APPLY_ALARM_MINUTES;
}

/**
 * بازه‌ی jitterِ ادبِ اپلای خودکار به میلی‌ثانیه (advisory برای افزونه).
 * اگر env معکوس باشد (min > max)، به‌صورتِ دفاعی جابه‌جا می‌شوند تا همیشه min ≤ max بماند.
 */
export function autoApplyJitterMs(): { min: number; max: number } {
  const a = env.KARJOO_AUTO_APPLY_JITTER_MS_MIN ?? DEFAULT_AUTO_APPLY_JITTER_MS_MIN;
  const b = env.KARJOO_AUTO_APPLY_JITTER_MS_MAX ?? DEFAULT_AUTO_APPLY_JITTER_MS_MAX;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
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
