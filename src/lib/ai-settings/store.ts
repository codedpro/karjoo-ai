import "server-only";

/**
 * لایه‌ی دادهٔ «کاتالوگِ مدل + تنظیماتِ هوش مصنوعیِ کاربر» (server-only) — Track A.
 *
 * این فایل تنها مسئولِ خواندن/نوشتنِ DB است (هیچ HTTP/UI). هم route handlerها
 * (`/api/models`, `/api/ai-settings`) و هم صفحه‌ی RSCِ مدل‌پیکر از همین لایه مصرف
 * می‌کنند تا منطقِ کوئری یک‌جا و تست‌پذیر بماند.
 *
 * قواعدِ ایمنی (§10 — دادهٔ هر کاربر فقط برای همان کاربر): توابعِ تنظیمات همیشه به
 * userIdِ احرازشده مقید می‌شوند (هرگز از بدنه/کوئری)؛ نوشتنِ تنظیمات فقط مدلی را
 * می‌پذیرد که در کاتالوگ موجود و enabled باشد (اعتبارسنجی سمتِ سرور). کاتالوگ خودش
 * عمومیِ-درون‌برنامه‌ای است (قیمت/برچسب)؛ راز/داده‌ی کاربری ندارد.
 *
 * db تزریق‌پذیر است (پیش‌فرض: کلاینتِ مشترک) تا تستِ بدونِ DB ممکن باشد.
 */
import { and, asc, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  aiModelCatalog,
  userAiSettings,
  type AiProvider,
} from "@/db/schema";
import { providerFromModelId } from "@/lib/billing/provider";

/** هندلِ کمینه‌ی Drizzle که این لایه برای خواندن نیاز دارد. */
export type CatalogReadDb = Pick<typeof defaultDb, "select">;
/** هندلِ کمینه‌ی Drizzle برای نوشتنِ تنظیمات (insert با onConflict). */
export type SettingsWriteDb = Pick<typeof defaultDb, "select" | "insert">;

/* ─────────────────────────────  کاتالوگ (خواندن)  ───────────────────────── */

/** یک مدلِ کاتالوگ همان‌طور که UI/پاسخِ API لازم دارد (بدونِ فیلدهای داخلی). */
export interface CatalogModel {
  modelId: string;
  provider: AiProvider;
  displayName: string;
  inputPer1kToman: number;
  outputPer1kToman: number;
  contextWindow: number | null;
  tags: string[];
}

/** ترتیبِ نمایشِ provider‌ها در UI (تب‌ها) — پایدار و قابلِ‌پیش‌بینی. */
export const PROVIDER_ORDER: AiProvider[] = ["openai", "anthropic", "google"];

/** برچسبِ نمایشیِ فارسیِ هر provider (برای تب‌ها/گروه‌بندی). */
export const PROVIDER_LABEL_FA: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

/**
 * همه‌ی مدل‌های فعالِ کاتالوگ را برمی‌گرداند (به ترتیبِ provider سپس قیمتِ ورودی).
 * فقط enabled — مدل‌های غیرفعال هرگز به کاربر نشان داده نمی‌شوند.
 */
export async function getEnabledCatalog(
  db: CatalogReadDb = defaultDb,
): Promise<CatalogModel[]> {
  const rows = await db
    .select({
      modelId: aiModelCatalog.modelId,
      provider: aiModelCatalog.provider,
      displayName: aiModelCatalog.displayName,
      inputPer1kToman: aiModelCatalog.inputPer1kToman,
      outputPer1kToman: aiModelCatalog.outputPer1kToman,
      contextWindow: aiModelCatalog.contextWindow,
      tags: aiModelCatalog.tags,
    })
    .from(aiModelCatalog)
    .where(eq(aiModelCatalog.enabled, true))
    .orderBy(asc(aiModelCatalog.provider), asc(aiModelCatalog.inputPer1kToman));

  return rows.map((r) => ({
    modelId: r.modelId,
    provider: r.provider,
    displayName: r.displayName,
    inputPer1kToman: r.inputPer1kToman,
    outputPer1kToman: r.outputPer1kToman,
    contextWindow: r.contextWindow ?? null,
    tags: r.tags ?? [],
  }));
}

/** یک گروهِ provider در کاتالوگِ گروه‌بندی‌شده (برای تب‌های UI). */
export interface CatalogGroup {
  provider: AiProvider;
  label: string;
  models: CatalogModel[];
}

/**
 * کاتالوگِ گروه‌بندی‌شده بر اساسِ provider — به ترتیبِ PROVIDER_ORDER. provider‌هایی
 * که هیچ مدلِ فعالی ندارند حذف می‌شوند (تبِ خالی نمایش داده نمی‌شود).
 */
export function groupByProvider(models: CatalogModel[]): CatalogGroup[] {
  const byProvider = new Map<AiProvider, CatalogModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  const groups: CatalogGroup[] = [];
  for (const provider of PROVIDER_ORDER) {
    const list = byProvider.get(provider);
    if (list && list.length > 0) {
      groups.push({ provider, label: PROVIDER_LABEL_FA[provider], models: list });
    }
  }
  // هر provider‌ای که در ترتیبِ پیش‌فرض نبود (دفاعی) در انتها بیاید.
  for (const [provider, list] of byProvider) {
    if (!PROVIDER_ORDER.includes(provider) && list.length > 0) {
      groups.push({
        provider,
        label: PROVIDER_LABEL_FA[provider] ?? provider,
        models: list,
      });
    }
  }
  return groups;
}

/** کاتالوگِ فعال را خوانده و یک‌جا گروه‌بندی‌شده برمی‌گرداند (میان‌برِ صفحه/route). */
export async function getCatalogGrouped(
  db: CatalogReadDb = defaultDb,
): Promise<CatalogGroup[]> {
  return groupByProvider(await getEnabledCatalog(db));
}

/**
 * modelIdِ مدلِ «recommended» (پیش‌فرضِ منطقی) را برمی‌گرداند — اولین مدلِ فعالی که
 * برچسبِ recommended دارد. اگر هیچ‌کدام برچسب نداشت، اولین مدلِ فعال؛ اگر کاتالوگ
 * خالی بود، null. برای هایلایتِ پیش‌فرض در UI و fallbackِ تنظیمات.
 */
export function recommendedModelId(models: CatalogModel[]): string | null {
  const rec = models.find((m) => m.tags.includes("recommended"));
  if (rec) return rec.modelId;
  return models[0]?.modelId ?? null;
}

/* ─────────────────────────  تنظیماتِ هوش مصنوعیِ کاربر  ──────────────────── */

/** تنظیماتِ مدلِ کاربر — مدلِ انتخابی (یا پیش‌فرضِ recommended اگر هنوز انتخاب نکرده). */
export interface UserModelSelection {
  provider: AiProvider;
  modelId: string;
  /** آیا این انتخابِ صریحِ کاربر است یا پیش‌فرضِ recommended (هنوز انتخاب نکرده). */
  isDefault: boolean;
}

/**
 * تنظیماتِ مدلِ یک کاربر را می‌خواند. اگر کاربر هنوز مدلی انتخاب نکرده باشد، مدلِ
 * recommended از کاتالوگ به‌عنوانِ پیش‌فرض (isDefault=true) برمی‌گردد؛ اگر کاتالوگ هم
 * خالی بود، null.
 *
 * نکته‌ی همگامیِ کاتالوگ: اگر مدلِ انتخابیِ کاربر دیگر فعال نباشد (از کاتالوگ حذف/
 * غیرفعال شده)، آن را نادیده می‌گیریم و به recommended برمی‌گردیم — تا فراخوانیِ بعدی
 * با مدلی که قیمت ندارد شکست نخورد.
 */
export async function getUserModelSelection(
  userId: string,
  db: CatalogReadDb = defaultDb,
): Promise<UserModelSelection | null> {
  const catalog = await getEnabledCatalog(db);
  const enabledIds = new Set(catalog.map((m) => m.modelId));

  const [chosen] = await db
    .select({
      provider: userAiSettings.provider,
      modelId: userAiSettings.modelId,
    })
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, userId))
    .limit(1);

  if (chosen && enabledIds.has(chosen.modelId)) {
    return { provider: chosen.provider, modelId: chosen.modelId, isDefault: false };
  }

  // پیش‌فرض: مدلِ recommended (یا اولین مدلِ فعال).
  const recId = recommendedModelId(catalog);
  if (!recId) return null;
  const rec = catalog.find((m) => m.modelId === recId)!;
  return { provider: rec.provider, modelId: rec.modelId, isDefault: true };
}

/** نتیجه‌ی تلاش برای ذخیره‌ی تنظیمات — موفق با انتخابِ ذخیره‌شده یا علتِ شکست. */
export type SetModelOutcome =
  | { ok: true; selection: { provider: AiProvider; modelId: string } }
  | { ok: false; reason: "model_not_found" };

/**
 * مدلِ انتخابیِ کاربر را تنظیم/به‌روز می‌کند (upsert روی userId). فقط مدلی پذیرفته
 * می‌شود که در کاتالوگ موجود و enabled باشد؛ در غیرِ این صورت `model_not_found`
 * (route آن را به ۴۰۴/۴۲۲ نگاشت می‌کند) — هرگز یک modelId دلخواه ذخیره نمی‌شود.
 *
 * provider از خودِ ردیفِ کاتالوگ گرفته می‌شود (نه از بدنه‌ی کلاینت) تا با مسیریابیِ
 * گیت‌وی هم‌خوان بماند.
 */
export async function setUserModel(
  userId: string,
  modelId: string,
  db: SettingsWriteDb = defaultDb,
  now: () => Date = () => new Date(),
): Promise<SetModelOutcome> {
  const [model] = await db
    .select({ provider: aiModelCatalog.provider, modelId: aiModelCatalog.modelId })
    .from(aiModelCatalog)
    .where(and(eq(aiModelCatalog.modelId, modelId), eq(aiModelCatalog.enabled, true)))
    .limit(1);

  if (!model) return { ok: false, reason: "model_not_found" };

  // provider از کاتالوگ (منبعِ حقیقت)؛ اگر به هر دلیل خالی بود، از پیشوندِ نام.
  const provider: AiProvider = model.provider ?? providerFromModelId(model.modelId);

  await db
    .insert(userAiSettings)
    .values({ userId, provider, modelId: model.modelId })
    .onConflictDoUpdate({
      target: userAiSettings.userId,
      set: { provider, modelId: model.modelId, updatedAt: now() },
    });

  return { ok: true, selection: { provider, modelId: model.modelId } };
}
