import "server-only";

/**
 * مترینگِ فراخوانیِ پولیِ هوش مصنوعی (server-only) — درِ ورودیِ تولید برای هر فراخوانیِ
 * مدلی که باید از کاربر هزینه بگیرد.
 *
 * گردشِ کار (مدلِ بیلینگِ قفل‌شده):
 *   ۱) مدل را حل کن: req.model یا مدلِ انتخابیِ کاربر (user_ai_settings) یا پیش‌فرضِ
 *      «recommended» از کاتالوگ.
 *   ۲) گیت: assertCanUsePaidAi(userId) — *پیش از* فراخوانیِ گیت‌وی. اگر موجودی کافی
 *      نباشد، InsufficientBalanceError و هیچ هزینه‌ی بالادستی خرج نمی‌شود.
 *   ۳) فراخوانیِ گیت‌وی (chatComplete/chatCompleteJson).
 *   ۴) در صورتِ موفقیت: هزینه را از usage محاسبه کن، سپس *اتمیک* یک usage_record +
 *      کسرِ کیف‌پول + ردیفِ دفتر بنویس (یک تراکنش). در صورتِ خطای گیت‌وی/مدل: هیچ کسری.
 *
 * درزِ تست‌پذیری: تسویه پشتِ `MeteringStore` کپسوله شده؛ پیاده‌سازیِ تولید
 * (drizzleMeteringStore) همه‌چیز را در یک تراکنشِ Drizzle انجام می‌دهد، تست یک storeِ
 * in-memory تزریق می‌کند.
 */
import { and, asc, eq, gte, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  aiModelCatalog,
  userAiSettings,
  usageRecords,
  wallets,
  walletLedger,
  type AiProvider,
  type UsageKind,
} from "@/db/schema";
import {
  chatComplete,
  chatCompleteJson,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type GatewayOptions,
} from "@/lib/ai/gateway";
import { resolveMarginPct } from "@/lib/env";
import { assertCanUsePaidAi, type EntitlementDeps } from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { computeCostFromPrice, priceFor, type ModelPrice } from "@/lib/billing/pricing";
import { providerFromModelId } from "@/lib/billing/provider";

/** هندلِ کاملِ Drizzle (به transaction نیاز داریم؛ پس کلِ کلاینت). */
export type MeteringDb = typeof defaultDb;

/** اطلاعاتِ هزینه‌ی یک فراخوانیِ مترشده (پس از تسویه). */
export interface MeteredCharge {
  modelId: string;
  provider: AiProvider;
  promptTokens: number;
  completionTokens: number;
  upstreamCostToman: number;
  marginPct: number;
  costToman: number;
  /** موجودیِ کیف‌پول پس از کسر. */
  balanceAfterToman: number;
  /** شناسه‌ی usage_record ساخته‌شده. */
  usageRecordId: string;
}

/** نتیجه‌ی یک فراخوانیِ مترشده: نتیجه‌ی خامِ گیت‌وی + هزینه‌ی محاسبه/کسرشده. */
export interface MeteredResult<T> {
  result: T;
  charge: MeteredCharge;
}

/**
 * درزِ تسویه‌ی مترینگ — usage_record + کسرِ کیف‌پول + دفتر، اتمیک. یک متد، چون
 * این سه نوشتن جدانشدنی‌اند (یا هر سه، یا هیچ‌کدام).
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
  }): Promise<{ usageRecordId: string; balanceAfterToman: number }>;
}

/* ───────────────────  پیاده‌سازیِ تولید (Drizzle, اتمیک)  ─────────────────── */

/** storeِ تولید: درجِ usage_record + کسرِ کیف‌پول + دفتر، همه در یک تراکنش. */
export function drizzleMeteringStore(db: MeteringDb): MeteringStore {
  return {
    async settle(args) {
      return db.transaction(async (tx) => {
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

        let balanceAfterToman: number;
        if (args.costToman > 0) {
          // تضمینِ وجودِ کیف‌پول (idempotent).
          await tx
            .insert(wallets)
            .values({ userId: args.userId })
            .onConflictDoNothing({ target: wallets.userId });

          // کسرِ اتمیک و *مشروط*: فقط اگر موجودی ≥ هزینه. شرطِ `balance >= cost` داخلِ
          // همان UPDATE است؛ قفلِ ردیف، debitهای همزمان را سریالایز می‌کند تا موجودی
          // هرگز منفی نشود (رفعِ TOCTOU: گیتِ پیش‌فراخوانی فقط balance>0 را چک می‌کند و
          // چند فراخوانیِ همزمان می‌توانستند با هم از آن رد شوند).
          const [updated] = await tx
            .update(wallets)
            .set({
              balanceToman: sql`${wallets.balanceToman} - ${args.costToman}`,
              updatedAt: new Date(args.now),
            })
            .where(
              and(
                eq(wallets.userId, args.userId),
                gte(wallets.balanceToman, args.costToman),
              ),
            )
            .returning({ balanceToman: wallets.balanceToman });

          if (!updated) {
            // موجودی در لحظه‌ی کسر کافی نبود (رقابتِ همزمان یا overspendِ یک فراخوانی) →
            // پرتابِ خطا کلِ تراکنش را rollback می‌کند (نه usage_record، نه ledger). مدل
            // قبلاً پاسخ داده ولی شارژ نمی‌شود؛ هزینه‌ی نادرِ این حالت به حسابِ کارجوست —
            // امن‌تر از منفی‌کردنِ کیف‌پولِ کاربر.
            const [w] = await tx
              .select({ balanceToman: wallets.balanceToman })
              .from(wallets)
              .where(eq(wallets.userId, args.userId))
              .limit(1);
            throw new InsufficientBalanceError({
              balanceToman: w?.balanceToman ?? 0,
              plan: "payg",
            });
          }
          balanceAfterToman = updated.balanceToman;

          await tx.insert(walletLedger).values({
            userId: args.userId,
            kind: "charge",
            amountToman: -args.costToman,
            balanceAfterToman,
            refType: "usage_record",
            refId: usage.id,
            description: `هزینه‌ی ${args.kind} با مدل ${args.modelId}`,
          });
        } else {
          const [w] = await tx
            .select({ balanceToman: wallets.balanceToman })
            .from(wallets)
            .where(eq(wallets.userId, args.userId))
            .limit(1);
          balanceAfterToman = w?.balanceToman ?? 0;
        }

        return { usageRecordId: usage.id, balanceAfterToman };
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
  /** درصدِ حاشیه — پیش‌فرض resolveMarginPct از env. */
  marginPct?: number;
  /** آپشن‌های گیت‌وی (fetch/adapter/config برای تست). */
  gateway?: GatewayOptions;
  /** وابستگی‌های گیتِ استحقاق (برای تست). */
  entitlement?: EntitlementDeps;
  /** storeِ تسویه — پیش‌فرض drizzleMeteringStore(db). تزریقی برای تست. */
  store?: MeteringStore;
  /** خواننده‌ی مدل/قیمت — تزریقی برای تست (وگرنه از کاتالوگ). */
  resolveModel?: (
    userId: string,
    explicitModel: string | undefined,
  ) => Promise<{ modelId: string; provider: AiProvider }>;
  priceFor?: (modelId: string) => Promise<ModelPrice>;
}

/* ─────────────────────────────  هسته‌ی مشترک  ───────────────────────────── */

async function meter<T>(
  userId: string,
  kind: UsageKind,
  modelOverride: string | undefined,
  call: (modelId: string) => Promise<{ result: T; usage: ChatCompletionResult["usage"] }>,
  opts: MeteringOptions,
): Promise<MeteredResult<T>> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? Date.now;
  const marginPct = opts.marginPct ?? resolveMarginPct();
  const store = opts.store ?? drizzleMeteringStore(db);
  const resolveModel =
    opts.resolveModel ??
    ((id: string, m: string | undefined) => resolveUserModel(id, m, db));
  const getPrice = opts.priceFor ?? ((m: string) => priceFor(m, db));

  // ۱) حلِ مدلِ کاربر (پیش از گیت — تا قیمتِ مدل را هم بتوانیم تأیید کنیم).
  const { modelId, provider } = await resolveModel(userId, modelOverride);

  // ۲) قیمتِ مدل از کاتالوگ — اگر مدل ناشناخته باشد، ModelNotFoundError پیش از فراخوانی.
  const price = await getPrice(modelId);

  // ۳) گیتِ استحقاق — *پیش از* فراخوانیِ گیت‌وی (هرگز بی‌سروصدا هزینه‌ی بالادست خرج نشود).
  await assertCanUsePaidAi(userId, opts.entitlement ?? { db });

  // ۴) فراخوانیِ گیت‌وی. اگر اینجا خطا بدهد، propagate می‌شود و *هیچ کسری* انجام نمی‌شود.
  const { result, usage } = await call(modelId);

  // ۵) محاسبه‌ی هزینه + تسویه‌ی اتمیک (usage_record + debit + ledger).
  const promptTokens = Math.max(0, usage?.promptTokens ?? 0);
  const completionTokens = Math.max(0, usage?.completionTokens ?? 0);
  const { upstreamCostToman, costToman } = computeCostFromPrice(
    promptTokens,
    completionTokens,
    price,
    marginPct,
  );

  const settled = await store.settle({
    userId,
    kind,
    provider,
    modelId: price.modelId,
    promptTokens,
    completionTokens,
    upstreamCostToman,
    marginPct,
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
      marginPct,
      costToman,
      balanceAfterToman: settled.balanceAfterToman,
      usageRecordId: settled.usageRecordId,
    },
  };
}

/* ──────────────────────────────  نقاطِ ورود  ────────────────────────────── */

/**
 * یک فراخوانیِ چتِ مترشده (خروجیِ متن). مدلِ درخواست در صورتِ نبود از تنظیماتِ کاربر
 * حل می‌شود. هزینه پس از فراخوانی محاسبه و از کیف‌پول کسر می‌شود.
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
    async (modelId) => {
      const result = await chatComplete({ ...req, model: modelId }, opts.gateway);
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
    async (modelId) => {
      const out = await chatCompleteJson({ ...req, model: modelId }, opts.gateway);
      return { result: out, usage: out.result.usage };
    },
    opts,
  );
}

/* ───────────────────────  storeِ in-memory برای تست  ────────────────────── */

/** یک MeteringStoreِ in-memory برای تست — usage/charge را در حافظه نگه می‌دارد. */
export function inMemoryMeteringStore(
  initialBalances: Record<string, number> = {},
): MeteringStore & {
  usage: Array<Record<string, unknown>>;
  balances: Map<string, number>;
} {
  const usage: Array<Record<string, unknown>> = [];
  const balances = new Map<string, number>(Object.entries(initialBalances));
  let seq = 0;

  return {
    usage,
    balances,
    async settle(args) {
      seq += 1;
      const usageRecordId = `usage-${seq}`;
      usage.push({ id: usageRecordId, ...args });
      const current = balances.get(args.userId) ?? 0;
      const balanceAfterToman =
        args.costToman > 0 ? current - args.costToman : current;
      if (args.costToman > 0) balances.set(args.userId, balanceAfterToman);
      return { usageRecordId, balanceAfterToman };
    },
  };
}
