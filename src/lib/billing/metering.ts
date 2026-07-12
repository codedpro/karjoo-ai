import "server-only";

/**
 * مترینگِ فراخوانیِ پولیِ هوش مصنوعی (server-only) — درِ ورودیِ تولید برای هر فراخوانیِ
 * مدلی که به کیف‌پولِ واحدِ 1xai مقید است.
 *
 * گردشِ کار (مدلِ بیلینگِ قفل‌شده — «کارجو فقط از پلن پول درمی‌آورد»):
 *   ۱) مدل را حل کن: req.model یا مدلِ انتخابیِ کاربر (user_ai_settings) یا پیش‌فرضِ
 *      «recommended» از کاتالوگ.
 *   ۲) گیت: assertCanUsePaidAi(userId) — *پیش از* فراخوانیِ گیت‌وی. موجودیِ واحدِ
 *      1xai ≤ ۰ ⇒ InsufficientBalanceError و هیچ هزینه‌ی بالادستی خرج نمی‌شود.
 *   ۳) کلیدِ APIِ 1xaiِ *خودِ کاربر* را بگیر (ensureOnexaiApiKey) و گیت‌وی را با همان
 *      کلید صدا بزن — 1xai خودش مصرف را با نرخِ خودِ کاربر از کیف‌پولِ واحد متر می‌کند.
 *      کارجو *هیچ* حاشیه‌ای نمی‌گیرد و *هیچ* کسرِ محلی انجام نمی‌دهد.
 *   ۴) در صورتِ موفقیت: یک usage_record با هزینه‌ی *تخمینی* (نرخِ لیستِ 1xai از
 *      کاتالوگ، حاشیه ۰) بنویس — فقط برای گاردریلِ بودجه‌ی سراسری (ai-budget) و
 *      تاریخچه/حسابرسی؛ شارژِ معتبر همان است که 1xai خودش ثبت می‌کند.
 *
 * درزِ تست‌پذیری: ثبتِ مصرف پشتِ `MeteringStore` کپسوله شده؛ پیاده‌سازیِ تولید
 * (drizzleMeteringStore) usage_record + شمارنده‌ی بودجه را در یک تراکنشِ Drizzle
 * می‌نویسد، تست یک storeِ in-memory تزریق می‌کند.
 */
import { asc, eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  aiModelCatalog,
  userAiSettings,
  usageRecords,
  type AiProvider,
  type UsageKind,
} from "@/db/schema";
import {
  chatComplete,
  chatCompleteJson,
  GatewayError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type GatewayConfig,
  type GatewayOptions,
} from "@/lib/ai/gateway";
import { requireOneXai } from "@/lib/env";
import { assertCanUsePaidAi, type EntitlementDeps } from "@/lib/billing/entitlement";
import { assertAiAvailable, incrementMonthUpstream } from "@/lib/billing/ai-budget";
import { ensureOnexaiApiKey } from "@/lib/billing/unified";
import { computeCostFromPrice, priceFor, type ModelPrice } from "@/lib/billing/pricing";
import { providerFromModelId } from "@/lib/billing/provider";

/** هندلِ کاملِ Drizzle (به transaction نیاز داریم؛ پس کلِ کلاینت). */
export type MeteringDb = typeof defaultDb;

/**
 * اطلاعاتِ هزینه‌ی یک فراخوانیِ مترشده. costToman/upstreamCostToman *تخمین* با نرخِ
 * لیستِ 1xai است (حاشیه ۰ — این دو برابرند)؛ شارژِ معتبر را 1xai با کلیدِ خودِ کاربر
 * انجام داده است.
 */
export interface MeteredCharge {
  modelId: string;
  provider: AiProvider;
  promptTokens: number;
  completionTokens: number;
  upstreamCostToman: number;
  costToman: number;
  /** شناسه‌ی usage_record ساخته‌شده. */
  usageRecordId: string;
}

/** نتیجه‌ی یک فراخوانیِ مترشده: نتیجه‌ی خامِ گیت‌وی + هزینه‌ی تخمینیِ ثبت‌شده. */
export interface MeteredResult<T> {
  result: T;
  charge: MeteredCharge;
}

/**
 * درزِ ثبتِ مصرفِ مترینگ — usage_record + شمارنده‌ی بودجه‌ی سراسری، اتمیک.
 * *هیچ* کسرِ کیف‌پولی این‌جا انجام نمی‌شود (شارژِ معتبر سمتِ 1xai است).
 */
export interface MeteringStore {
  settle(args: {
    userId: string;
    kind: UsageKind;
    provider: AiProvider;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    upstreamCostToman: number;
    marginPct: number;
    costToman: number;
    now: number;
  }): Promise<{ usageRecordId: string }>;
}

/* ───────────────────  پیاده‌سازیِ تولید (Drizzle, اتمیک)  ─────────────────── */

/**
 * storeِ تولید: درجِ usage_record + افزایشِ شمارنده‌ی بودجه، در یک تراکنش.
 *
 * نکته: مبالغِ ثبت‌شده *تخمین* با نرخِ لیستِ 1xai (از کاتالوگ) هستند — برای گاردریلِ
 * بودجه‌ی سراسری (assertAiAvailable روی جمعِ همین رکوردها کار می‌کند) و تاریخچه‌ی
 * کاربر. شارژِ معتبر همان لحظه سمتِ 1xai با کلیدِ خودِ کاربر انجام شده است؛ این‌جا
 * دیگر هیچ debit/دفتری روی کیف‌پولِ محلیِ بازنشسته نوشته نمی‌شود.
 */
export function drizzleMeteringStore(db: MeteringDb): MeteringStore {
  return {
    async settle(args) {
      return db.transaction(async (tx) => {
        // ۰) گاردریلِ بودجه‌ی سراسری: شمارنده‌ی هزینه‌ی بالادستِ ماه را *داخلِ همین
        //    تراکنش* افزایش بده (اتمیک با usage_record). no-op اگر upstream ≤ ۰.
        await incrementMonthUpstream(args.upstreamCostToman, tx, args.now);

        // ۱) usage_record — همیشه ثبت می‌شود (حتی هزینه‌ی صفر، برای حسابرسی).
        const [usage] = await tx
          .insert(usageRecords)
          .values({
            userId: args.userId,
            kind: args.kind,
            provider: args.provider,
            modelId: args.modelId,
            promptTokens: args.promptTokens,
            completionTokens: args.completionTokens,
            upstreamCostToman: args.upstreamCostToman,
            marginPct: args.marginPct,
            costToman: args.costToman,
          })
          .returning({ id: usageRecords.id });

        return { usageRecordId: usage.id };
      });
    },
  };
}

/* ─────────────────────────────  حلِ مدلِ کاربر  ──────────────────────────── */

/** هندلِ کمینه‌ی DB برای حلِ مدل (select). */
export type ModelResolveDb = Pick<MeteringDb, "select">;

/**
 * مدلی که برای فراخوانیِ کاربر استفاده می‌شود را حل می‌کند:
 *   ۱) اگر درخواست صریحاً model داشت → همان (و provider از پیشوندِ نام).
 *   ۲) وگرنه مدلِ انتخابیِ کاربر از user_ai_settings.
 *   ۳) وگرنه مدلِ «recommended» و فعالِ کاتالوگ (پیش‌فرضِ منطقی).
 *   ۴) وگرنه اولین مدلِ فعالِ کاتالوگ.
 */
export async function resolveUserModel(
  userId: string,
  explicitModel: string | undefined,
  db: ModelResolveDb,
): Promise<{ modelId: string; provider: AiProvider }> {
  if (explicitModel) {
    return { modelId: explicitModel, provider: providerFromModelId(explicitModel) };
  }

  const [chosen] = await db
    .select({ modelId: userAiSettings.modelId, provider: userAiSettings.provider })
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .limit(1);
  if (chosen) return chosen;

  // پیش‌فرضِ ضمنی باید *ارزان‌ترین* مدلِ مناسب باشد، نه یک ردیفِ دلخواه — تا اگر کاربر
  // مدلی انتخاب نکرده باشد، هرگز به‌طورِ ناخواسته گران‌ترین مدل (مثلاً opus/gpt-5) برایش
  // اجرا و حساب نشود (رفعِ یافته‌ی ممیزی: ORDER BY قیمت ASC روی هر دو fallback).
  const [recommended] = await db
    .select({ modelId: aiModelCatalog.modelId, provider: aiModelCatalog.provider })
    .from(aiModelCatalog)
    .where(
      sql`${aiModelCatalog.enabled} = true AND 'recommended' = ANY(${aiModelCatalog.tags})`,
    )
    .orderBy(asc(aiModelCatalog.inputPer1kToman))
    .limit(1);
  if (recommended) return recommended;

  const [anyEnabled] = await db
    .select({ modelId: aiModelCatalog.modelId, provider: aiModelCatalog.provider })
    .from(aiModelCatalog)
    .where(eq(aiModelCatalog.enabled, true))
    .orderBy(asc(aiModelCatalog.inputPer1kToman))
    .limit(1);
  if (anyEnabled) return anyEnabled;

  throw new Error(
    "هیچ مدلی برای فراخوانیِ هوش مصنوعی در دسترس نیست (کاتالوگ خالی است؛ ابتدا catalog-sync/seed را اجرا کنید).",
  );
}

/* ─────────────────────────────  آپشن‌های مترینگ  ─────────────────────────── */

/** آپشن‌های مترینگ — کنارِ GatewayOptions برای تزریقِ DB/ساعت/استحقاق/استورها. */
export interface MeteringOptions {
  db?: MeteringDb;
  now?: () => number;
  /** آپشن‌های گیت‌وی (fetch/adapter/config برای تست). apiKey با کلیدِ کاربر جایگزین می‌شود. */
  gateway?: GatewayOptions;
  /** وابستگی‌های گیتِ استحقاق (برای تست). */
  entitlement?: EntitlementDeps;
  /**
   * گاردِ در دسترس بودنِ هوش مصنوعی (حالتِ نگه‌داریِ بودجه‌ی سراسری). پیش‌فرض
   * assertAiAvailable(db) از ai-budget. تزریقی برای تست (تا بدونِ DB اجرا شود).
   */
  assertAiAvailable?: (db: MeteringDb) => Promise<void>;
  /**
   * تأمین‌کننده‌ی کلیدِ APIِ 1xaiِ خودِ کاربر — پیش‌فرض ensureOnexaiApiKey از
   * @/lib/billing/unified (صدور/کشِ کلید روی ردیفِ کاربر). تزریقی برای تست.
   */
  ensureApiKey?: (userId: string) => Promise<string>;
  /** storeِ ثبتِ مصرف — پیش‌فرض drizzleMeteringStore(db). تزریقی برای تست. */
  store?: MeteringStore;
  /** خواننده‌ی مدل/قیمت — تزریقی برای تست (وگرنه از کاتالوگ). */
  resolveModel?: (
    userId: string,
    explicitModel: string | undefined,
  ) => Promise<{ modelId: string; provider: AiProvider }>;
  priceFor?: (modelId: string) => Promise<ModelPrice>;
}

/* ─────────────────────────────  هسته‌ی مشترک  ───────────────────────────── */

/**
 * پیکربندیِ پایه‌ی گیت‌وی از env (baseUrl/model) — apiKey آن بعداً با کلیدِ خودِ کاربر
 * جایگزین می‌شود. غیابِ env ⇒ همان GatewayError('not_configured') همیشگی (typed).
 */
function resolveEnvGatewayConfig(): GatewayConfig {
  try {
    return requireOneXai();
  } catch (cause) {
    throw new GatewayError(
      "not_configured",
      cause instanceof Error
        ? cause.message
        : "سرویس هوش مصنوعی پیکربندی نشده است (ONEXAI_*).",
      { cause },
    );
  }
}

async function meter<T>(
  userId: string,
  kind: UsageKind,
  modelOverride: string | undefined,
  call: (
    modelId: string,
    gateway: GatewayOptions,
  ) => Promise<{ result: T; usage: ChatCompletionResult["usage"] }>,
  opts: MeteringOptions,
): Promise<MeteredResult<T>> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? Date.now;
  const store = opts.store ?? drizzleMeteringStore(db);
  const ensureApiKey =
    opts.ensureApiKey ?? ((id: string) => ensureOnexaiApiKey(id, { db }));
  const resolveModel =
    opts.resolveModel ??
    ((id: string, m: string | undefined) => resolveUserModel(id, m, db));
  const getPrice = opts.priceFor ?? ((m: string) => priceFor(m, db));

  // ۱) حلِ مدلِ کاربر (پیش از گیت — تا قیمتِ مدل را هم بتوانیم تأیید کنیم).
  const { modelId, provider } = await resolveModel(userId, modelOverride);

  // ۲) قیمتِ مدل از کاتالوگ — اگر مدل ناشناخته باشد، ModelNotFoundError پیش از فراخوانی.
  const price = await getPrice(modelId);

  // ۳) گیتِ استحقاق — *پیش از* فراخوانیِ گیت‌وی (هرگز بی‌سروصدا هزینه‌ی بالادست خرج نشود).
  //    موجودی از کیف‌پولِ واحدِ 1xai خوانده می‌شود؛ svcِ در دسترس‌نبودن fail-closed است.
  await assertCanUsePaidAi(userId, opts.entitlement ?? { db });

  // ۳٫۵) گاردریلِ بودجه‌ی سراسری — اگر اپ در حالتِ نگه‌داریِ هوش مصنوعی باشد (سقفِ ماهانه
  //      رسیده یا پرچمِ دستی روشن)، AiMaintenanceError و *هیچ فراخوانیِ گیت‌وی*. این هم
  //      پیش از فراخوانی است تا هزینه‌ی بالادست خرج نشود.
  const checkAiAvailable = opts.assertAiAvailable ?? ((d: MeteringDb) => assertAiAvailable(d));
  await checkAiAvailable(db);

  // ۴) کلیدِ خودِ کاربر (پس از گیت‌ها — برای کاربرِ بی‌موجودی کلیدی صادر نمی‌شود) و
  //    فراخوانیِ گیت‌وی با همان کلید: 1xai مصرف را با نرخِ خودِ کاربر از کیف‌پولِ واحد
  //    متر می‌کند (بدونِ حاشیه/کسرِ کارجو). baseUrl/model از env (یا configِ تزریقی).
  const userKey = await ensureApiKey(userId);
  const baseConfig = opts.gateway?.config ?? resolveEnvGatewayConfig();
  const gatewayOpts: GatewayOptions = {
    ...opts.gateway,
    config: { ...baseConfig, apiKey: userKey },
  };

  // اگر گیت‌وی خطا بدهد، propagate می‌شود و *هیچ رکوردی* ثبت نمی‌شود.
  const { result, usage } = await call(modelId, gatewayOpts);

  // ۵) ثبتِ مصرف: هزینه‌ی *تخمینی* با نرخِ لیستِ 1xai (حاشیه ۰ — کارجو مارجین ندارد).
  //    این عدد فقط خوراکِ گاردریلِ بودجه‌ی سراسری (ai-budget) و تاریخچه است؛ شارژِ
  //    معتبر همان است که 1xai هنگامِ فراخوانی با کلیدِ کاربر انجام داده.
  const promptTokens = Math.max(0, usage?.promptTokens ?? 0);
  const completionTokens = Math.max(0, usage?.completionTokens ?? 0);
  const { upstreamCostToman, costToman } = computeCostFromPrice(
    promptTokens,
    completionTokens,
    price,
    0,
  );

  const settled = await store.settle({
    userId,
    kind,
    provider,
    modelId: price.modelId,
    promptTokens,
    completionTokens,
    upstreamCostToman,
    marginPct: 0,
    costToman,
    now: now(),
  });

  return {
    result,
    charge: {
      modelId: price.modelId,
      provider,
      promptTokens,
      completionTokens,
      upstreamCostToman,
      costToman,
      usageRecordId: settled.usageRecordId,
    },
  };
}

/* ──────────────────────────────  نقاطِ ورود  ────────────────────────────── */

/**
 * یک فراخوانیِ چتِ مترشده (خروجیِ متن). مدلِ درخواست در صورتِ نبود از تنظیماتِ کاربر
 * حل می‌شود. فراخوانی با کلیدِ 1xaiِ خودِ کاربر انجام و همان‌جا متر می‌شود؛ این‌جا فقط
 * usage_record تخمینی ثبت می‌گردد.
 */
export async function meteredChat(
  userId: string,
  kind: UsageKind,
  req: ChatCompletionRequest,
  opts: MeteringOptions = {},
): Promise<MeteredResult<ChatCompletionResult>> {
  return meter<ChatCompletionResult>(
    userId,
    kind,
    req.model,
    async (modelId, gateway) => {
      const result = await chatComplete({ ...req, model: modelId }, gateway);
      return { result, usage: result.usage };
    },
    opts,
  );
}

/**
 * یک فراخوانیِ چتِ مترشده با خروجیِ JSON ساختاریافته. مثلِ chatCompleteJson اما با
 * مترینگ. اعتبارسنجیِ شکلِ دقیق (zod) همچنان مسئولیتِ فراخواننده است.
 */
export async function meteredChatJson(
  userId: string,
  kind: UsageKind,
  req: Omit<ChatCompletionRequest, "responseFormat">,
  opts: MeteringOptions = {},
): Promise<MeteredResult<{ data: unknown; result: ChatCompletionResult }>> {
  return meter<{ data: unknown; result: ChatCompletionResult }>(
    userId,
    kind,
    req.model,
    async (modelId, gateway) => {
      const out = await chatCompleteJson({ ...req, model: modelId }, gateway);
      return { result: out, usage: out.result.usage };
    },
    opts,
  );
}

/* ───────────────────────  storeِ in-memory برای تست  ────────────────────── */

/** یک MeteringStoreِ in-memory برای تست — usage را در حافظه نگه می‌دارد (بدونِ کیف‌پول). */
export function inMemoryMeteringStore(): MeteringStore & {
  usage: Array<Record<string, unknown>>;
} {
  const usage: Array<Record<string, unknown>> = [];
  let seq = 0;

  return {
    usage,
    async settle(args) {
      seq += 1;
      const usageRecordId = `usage-${seq}`;
      usage.push({ id: usageRecordId, ...args });
      return { usageRecordId };
    },
  };
}
