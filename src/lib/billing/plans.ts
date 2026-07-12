/**
 * تعریفِ نسخه‌دارِ لایه‌های قیمت‌گذاریِ کارجو (WF3) — منبعِ حقیقتِ پلن‌ها.
 *
 * این فایل «خالص» است (بدونِ DB، بدونِ راز، بدونِ I/O) تا هم در سرور و هم در UI/تست
 * بدونِ اصطکاک قابلِ استفاده باشد — به همین خاطر "server-only" نیست.
 *
 * قاعده‌ی قفل‌شده (CONTEXT بخش C): پلن، *گرنت/سهمیه/ورکرها* را تعیین می‌کند، نه یک
 * بلاکِ سراسریِ هوش مصنوعی. گیتِ هوش مصنوعی روی *موجودیِ کیف‌پول* است (هر پلنی با
 * موجودی > ۰ می‌تواند از AI استفاده کند) — به entitlement.assertCanUsePaidAi نگاه کنید.
 *
 * مبالغ به تومان‌اند (واحدِ صحیح). monthlyCreditToman اعتباری است که هنگامِ ارتقا و
 * ماهانه به کیف‌پولِ کاربر credit می‌شود (grants.grantMonthlyCredits).
 */
import type { Plan } from "@/db/schema";

/** نسخه‌ی شِمای تعریفِ پلن — اگر ساختار تغییر کرد، این را بالا ببرید. */
export const PLANS_VERSION = 1 as const;

/** کلیدهای پلنِ «فعال» (فروختنی) — مقادیرِ تاریخی payg/premium اینجا نیستند. */
export type PlanKey = "free" | "pro" | "max" | "maxplus";

/** شکلِ یک تعریفِ پلن (نسخه‌دار). */
export interface PlanDefinition {
  /** کلیدِ پلن — هم‌راستا با planEnum (زیرمجموعه‌ی فعال). */
  key: PlanKey;
  /** نامِ نمایشیِ فارسی. */
  labelFa: string;
  /** قیمتِ ماهانه به تومان (free = ۰). */
  priceToman: number;
  /** اعتبارِ ماهانه‌ی هوش مصنوعی که به کیف‌پول credit می‌شود، به تومان (free = ۰). */
  monthlyCreditToman: number;
  /**
   * سقفِ اپلای در روز — free = ۱۰۰؛ پلن‌های پولی = null (نامحدود).
   * apply-quota.assertApplyQuota این را اعمال می‌کند.
   */
  applyQuotaPerDay: number | null;
  /** تعدادِ IPِ ورکرِ auto-apply مجاز — free/pro = ۰، max = ۱، maxplus = ۵. */
  workerIpLimit: number;
  /** آیا «تماسِ مستقیم» (پشتیبانی/کانال اختصاصی) دارد؟ */
  directContact: boolean;
  /** فهرستِ قابلیت‌ها (برای نمایش در UI/مقایسه). */
  features: string[];
}

/**
 * تعریفِ پلن‌ها — مرجعِ واحد (پس از اتحاد با 1xAi):
 * پلن = «استحقاق + قیمت». هیچ اعتبارِ کیف‌پولی‌ای اعطا نمی‌شود (monthlyCreditToman
 * همه‌جا ۰ است و فقط برای سازگاریِ نوع/ماشینِ خفته‌ی grants مانده) — هوش مصنوعی برای
 * *همه‌ی* پلن‌ها با نرخِ خودِ 1xai از کیف‌پولِ واحد مصرف می‌شود؛ ارزشِ پلن‌های پولی
 * سهمیه/ورکر/پشتیبانی است:
 *   • Free    = ۰        | ۱۰۰ اپلای/روز | همه‌ی قابلیت‌ها + AI به‌میزانِ مصرف
 *   • Pro     = ۲۹۹۰۰۰   | اپلای نامحدود (افزونه)
 *   • Max     = ۹۹۹۰۰۰   | نامحدود | ورکرِ auto-apply با ۱ IP (۲۴/۷)
 *   • MaxPlus = ۱۹۹۰۰۰۰  | نامحدود | ۵ IPِ ورکر | تماسِ مستقیم
 */
export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    labelFa: "رایگان",
    priceToman: 0,
    monthlyCreditToman: 0,
    applyQuotaPerDay: 100,
    workerIpLimit: 0,
    directContact: false,
    features: [
      "همه‌ی قابلیت‌های پایه + هوش مصنوعی به‌میزانِ مصرف (کیف‌پولِ واحدِ 1xAi)",
      "۱۰۰ اپلای در روز",
      "آپلود رزومه و استخراج متن",
      "ایمپورت پروفایل از سایت‌های کاریابی",
    ],
  },
  pro: {
    key: "pro",
    labelFa: "حرفه‌ای",
    priceToman: 299_000,
    monthlyCreditToman: 0,
    applyQuotaPerDay: null,
    workerIpLimit: 0,
    directContact: false,
    features: [
      "اپلای نامحدود از طریقِ افزونه",
      "هوش مصنوعی با نرخِ خودِ 1xAi (بدونِ حاشیه‌ی کارجو)",
      "اولویتِ پشتیبانی",
    ],
  },
  max: {
    key: "max",
    labelFa: "مکس",
    priceToman: 999_000,
    monthlyCreditToman: 0,
    applyQuotaPerDay: null,
    workerIpLimit: 1,
    directContact: false,
    features: [
      "اپلای نامحدود",
      "اپلای خودکارِ ۲۴/۷ روی سرور (۱ IPِ ورکر)",
      "هوش مصنوعی با نرخِ خودِ 1xAi",
    ],
  },
  maxplus: {
    key: "maxplus",
    labelFa: "مکس پلاس",
    priceToman: 1_990_000,
    monthlyCreditToman: 0,
    applyQuotaPerDay: null,
    workerIpLimit: 5,
    directContact: true,
    features: [
      "اپلای نامحدود",
      "اپلای خودکارِ ۲۴/۷ با ۵ IPِ ورکر",
      "تماسِ مستقیم و پشتیبانیِ اختصاصی",
      "هوش مصنوعی با نرخِ خودِ 1xAi",
    ],
  },
};

/** فهرستِ مرتب‌شده‌ی پلن‌ها بر اساسِ قیمت (برای نمایشِ صفحه‌ی قیمت‌گذاری). */
export const PLAN_LIST: PlanDefinition[] = [
  PLAN_DEFINITIONS.free,
  PLAN_DEFINITIONS.pro,
  PLAN_DEFINITIONS.max,
  PLAN_DEFINITIONS.maxplus,
];

/**
 * نگاشتِ مقادیرِ تاریخیِ planEnum (payg/premium) به پلنِ فعالِ معادل — تا کاربرانِ
 * قدیمی همچنان یک تعریفِ معتبر بگیرند: payg→free، premium→pro (مطابقِ مهاجرت).
 */
const LEGACY_PLAN_MAP: Record<string, PlanKey> = {
  payg: "free",
  premium: "pro",
};

/** کلیدِ پلنِ خام (planEnum) را به یک PlanKeyِ فعال نرمال می‌کند. */
export function normalizePlanKey(plan: Plan | string): PlanKey {
  if (plan in PLAN_DEFINITIONS) return plan as PlanKey;
  return LEGACY_PLAN_MAP[plan] ?? "free";
}

/**
 * تعریفِ پلن را برای یک کلید برمی‌گرداند. مقادیرِ تاریخی (payg/premium) و کلیدهای
 * ناشناخته به‌صورتِ دفاعی به free/pro نگاشت می‌شوند (هرگز throw نمی‌کند).
 */
export function planFor(plan: Plan | string): PlanDefinition {
  return PLAN_DEFINITIONS[normalizePlanKey(plan)];
}

/** سقفِ IPِ ورکرِ این پلن (free/pro = ۰، max = ۱، maxplus = ۵). */
export function workerIpLimitFor(plan: Plan | string): number {
  return planFor(plan).workerIpLimit;
}

/** سقفِ اپلای روزانه‌ی این پلن — عدد برای free (۱۰۰)، null برای نامحدود. */
export function applyQuotaFor(plan: Plan | string): number | null {
  return planFor(plan).applyQuotaPerDay;
}

/** اعتبارِ ماهانه‌ی هوش مصنوعیِ این پلن به تومان (free = ۰). */
export function monthlyCreditFor(plan: Plan | string): number {
  return planFor(plan).monthlyCreditToman;
}
