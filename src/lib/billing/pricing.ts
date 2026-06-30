import "server-only";

/**
 * قیمت‌گذاری و محاسبه‌ی هزینه‌ی فراخوانیِ پولیِ هوش مصنوعی (server-only).
 *
 * مدلِ بیلینگِ قفل‌شده (CONTEXT):
 *   هزینه = (promptTokens×inputPrice + completionTokens×outputPrice) از کاتالوگ،
 *   × (۱ + MARGIN). قیمت‌ها در کاتالوگ «به‌ازای هر ۱۰۰۰ توکن، به تومان» ذخیره شده‌اند.
 *
 * چرا bigint/round؟ تومان واحدِ صحیح است؛ همه‌ی محاسبات با عددِ صحیح انجام و در پایان
 * گرد می‌شوند تا خطای ممیزِ شناور به موجودی نشت نکند.
 *
 * db تزریق‌پذیر است (پیش‌فرض: کلاینتِ مشترک) تا تستِ بدونِ DB ممکن باشد.
 */
import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { aiModelCatalog, type AiModelCatalogRow } from "@/db/schema";
import { ModelNotFoundError } from "@/lib/billing/errors";

/** هندلِ کمینه‌ی Drizzle که این لایه نیاز دارد. در تست یک fake سبک تزریق می‌شود. */
export type PricingDb = Pick<typeof defaultDb, "select">;

/** قیمتِ یک مدل — جدا از کلِ ردیفِ کاتالوگ تا فراخواننده فقط آنچه لازم است بگیرد. */
export interface ModelPrice {
  modelId: string;
  provider: AiModelCatalogRow["provider"];
  /** قیمتِ ورودی به‌ازای هر ۱۰۰۰ توکن (تومان). */
  inputPer1kToman: number;
  /** قیمتِ خروجی به‌ازای هر ۱۰۰۰ توکن (تومان). */
  outputPer1kToman: number;
}

/**
 * قیمتِ یک مدل را از کاتالوگ می‌خواند (فقط مدلِ enabled). اگر مدل نبود/غیرفعال بود،
 * `ModelNotFoundError` پرتاب می‌شود — فراخواننده هرگز با قیمتِ نامعلوم پیش نمی‌رود.
 */
export async function priceFor(
  modelId: string,
  db: PricingDb = defaultDb,
): Promise<ModelPrice> {
  const [row] = await db
    .select({
      modelId: aiModelCatalog.modelId,
      provider: aiModelCatalog.provider,
      inputPer1kToman: aiModelCatalog.inputPer1kToman,
      outputPer1kToman: aiModelCatalog.outputPer1kToman,
    })
    .from(aiModelCatalog)
    .where(and(eq(aiModelCatalog.modelId, modelId), eq(aiModelCatalog.enabled, true)))
    .limit(1);

  if (!row) {
    throw new ModelNotFoundError(modelId);
  }
  return row;
}

/** نتیجه‌ی محاسبه‌ی هزینه: هزینه‌ی بالادست (پیش از حاشیه) و هزینه‌ی نهاییِ کاربر. */
export interface ComputedCost {
  /** هزینه‌ی خامِ بالادست (1xai) به تومان — پیش از حاشیه‌ی سود. */
  upstreamCostToman: number;
  /** هزینه‌ی نهاییِ کسرشده از کاربر = upstream × (۱ + margin/۱۰۰)، گرد. */
  costToman: number;
}

/**
 * هزینه‌ی یک فراخوانی را از توکن‌های مصرف‌شده و قیمتِ مدل محاسبه می‌کند (تابعِ خالص).
 *
 * @param price قیمتِ مدل (از priceFor) — یا یک شیءِ ModelPrice برای محاسبه‌ی مستقیم.
 * @param marginPct درصدِ حاشیه‌ی سودِ کارجو (از resolveMarginPct).
 *
 * نکته‌ی محاسباتی: قیمت «به‌ازای ۱۰۰۰ توکن» است؛ هزینه‌ی بالادست را با تقسیمِ شناور
 * بر ۱۰۰۰ می‌گیریم و فقط در «هزینه‌ی نهایی» (که از کیف‌پول کسر می‌شود) گرد می‌کنیم.
 * upstreamCostToman هم برای ثبت در usage_record گرد می‌شود تا یک عددِ صحیح بماند.
 */
export function computeCostFromPrice(
  promptTokens: number,
  completionTokens: number,
  price: ModelPrice,
  marginPct: number,
): ComputedCost {
  const safePrompt = Math.max(0, promptTokens || 0);
  const safeCompletion = Math.max(0, completionTokens || 0);
  const safeMargin = Math.max(0, marginPct || 0);

  const upstreamRaw =
    (safePrompt * price.inputPer1kToman + safeCompletion * price.outputPer1kToman) /
    1000;

  const upstreamCostToman = Math.round(upstreamRaw);
  const costToman = Math.round(upstreamRaw * (1 + safeMargin / 100));

  return { upstreamCostToman, costToman };
}

/**
 * نسخه‌ی راحت که قیمت را از کاتالوگ می‌خواند و سپس هزینه را محاسبه می‌کند.
 * در صورتِ نبودِ مدل، `ModelNotFoundError` پرتاب می‌شود.
 */
export async function computeCost(
  promptTokens: number,
  completionTokens: number,
  modelId: string,
  marginPct: number,
  db: PricingDb = defaultDb,
): Promise<ComputedCost & { price: ModelPrice }> {
  const price = await priceFor(modelId, db);
  const cost = computeCostFromPrice(promptTokens, completionTokens, price, marginPct);
  return { ...cost, price };
}
