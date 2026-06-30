import "server-only";

/**
 * همگام‌سازیِ کاتالوگِ مدل‌ها (server-only) — قیمت‌گذاریِ مدل‌ها را در ai_model_catalog
 * پر/به‌روز می‌کند.
 *
 * منبعِ زنده: گیت‌وی 1xai یک کاتالوگِ عمومی JSON دارد —
 *   GET {origin}/pricing  (قیمتِ زنده به تومان + پنجره‌ی متن)
 *   GET {origin}/models   (فهرستِ مدل‌ها)
 * origin از ONEXAI_BASE_URL با حذفِ پسوندِ /v1 گرفته می‌شود.
 *
 * مقاوم‌سازی: اگر اندپوینت در دسترس نباشد، شکلِ متفاوتی بدهد، یا خالی برگردد، به یک
 * SEEDِ منحنیِ مدل‌های شناخته‌شده (با قیمتِ منطقیِ تومان + برچسب) سقوط می‌کنیم تا
 * کاتالوگ هرگز خالی نماند. upsert بر اساسِ modelId است (idempotent).
 *
 * برچسب‌گذاری (CONTEXT): recommended = یک مدلِ منتخب به‌ازای هر provider؛ premium =
 * گران‌ترین؛ cheap/fast = mini/flash/haiku/lite؛ persian = خانواده‌ی claude/gpt.
 */
import { db as defaultDb } from "@/db";
import {
  aiModelCatalog,
  type AiProvider,
  type NewAiModelCatalogRow,
} from "@/db/schema";
import { env } from "@/lib/env";
import { providerFromModelId } from "@/lib/billing/provider";

/** هندلِ کمینه‌ی Drizzle که این لایه نیاز دارد. */
export type CatalogDb = Pick<typeof defaultDb, "insert">;

/** نوعِ تزریق‌پذیرِ fetch (برای تستِ بدونِ شبکه). */
export type CatalogFetch = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/* ───────────────────────────────  SEED  ─────────────────────────────────── */

/**
 * یک ردیفِ seed — قیمت‌ها «به‌ازای هر ۱۰۰۰ توکن، به تومان». این اعداد تخمینی و منطقی
 * برای بازارِ ایران‌اند و هنگامِ همگام‌سازیِ زنده با قیمتِ واقعیِ گیت‌وی جایگزین می‌شوند.
 */
interface SeedModel {
  modelId: string;
  displayName: string;
  inputPer1kToman: number;
  outputPer1kToman: number;
  contextWindow: number;
}

/** مدل‌های شناخته‌شده‌ی گیت‌وی 1xai (CONTEXT) با قیمتِ تخمینیِ تومان. */
export const SEED_MODELS: SeedModel[] = [
  // OpenAI
  { modelId: "gpt-4o-mini", displayName: "GPT-4o mini", inputPer1kToman: 90, outputPer1kToman: 360, contextWindow: 128_000 },
  { modelId: "gpt-5", displayName: "GPT-5", inputPer1kToman: 1_600, outputPer1kToman: 12_800, contextWindow: 256_000 },
  // Anthropic
  { modelId: "claude-3-5-haiku", displayName: "Claude 3.5 Haiku", inputPer1kToman: 480, outputPer1kToman: 2_400, contextWindow: 200_000 },
  { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", inputPer1kToman: 1_800, outputPer1kToman: 9_000, contextWindow: 200_000 },
  { modelId: "claude-opus-4-7", displayName: "Claude Opus 4.7", inputPer1kToman: 9_000, outputPer1kToman: 45_000, contextWindow: 200_000 },
  // Google
  { modelId: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite", inputPer1kToman: 60, outputPer1kToman: 240, contextWindow: 1_000_000 },
  { modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputPer1kToman: 180, outputPer1kToman: 1_500, contextWindow: 1_000_000 },
  { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputPer1kToman: 750, outputPer1kToman: 6_000, contextWindow: 1_000_000 },
];

/** مدلِ «recommended» به‌ازای هر provider (CONTEXT: یک مدلِ منتخبِ منطقی). */
const RECOMMENDED_BY_PROVIDER: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku",
  google: "gemini-2.5-flash",
};

/* ───────────────────────────  برچسب‌گذاری  ─────────────────────────────── */

/**
 * برچسب‌های یک مدل را استخراج می‌کند:
 *   • recommended — اگر این مدل، مدلِ منتخبِ providerش باشد.
 *   • premium     — اگر گران‌ترینِ providerش باشد (بر اساسِ outputPer1kToman).
 *   • cheap/fast  — اگر نامش mini/flash/haiku/lite داشته باشد.
 *   • persian     — خانواده‌ی claude/gpt (CONTEXT: کیفیتِ فارسیِ بهتر).
 */
function deriveTags(
  modelId: string,
  provider: AiProvider,
  outputPrice: number,
  maxOutputForProvider: number,
): string[] {
  const tags = new Set<string>();
  const id = modelId.toLowerCase();

  if (RECOMMENDED_BY_PROVIDER[provider] === modelId) tags.add("recommended");
  if (outputPrice >= maxOutputForProvider && maxOutputForProvider > 0) tags.add("premium");
  if (/mini|flash|haiku|lite/.test(id)) {
    tags.add("cheap");
    tags.add("fast");
  }
  if (id.startsWith("claude") || id.startsWith("gpt")) tags.add("persian");

  return [...tags];
}

/** ردیف‌های نهاییِ کاتالوگ را از مجموعه‌ای از مدل‌های قیمت‌دار می‌سازد (با برچسب). */
function toCatalogRows(models: SeedModel[]): NewAiModelCatalogRow[] {
  // بیشینه‌ی قیمتِ خروجی به‌ازای هر provider — برای برچسبِ premium.
  const maxOutput: Record<string, number> = {};
  for (const m of models) {
    const p = providerFromModelId(m.modelId);
    maxOutput[p] = Math.max(maxOutput[p] ?? 0, m.outputPer1kToman);
  }

  return models.map((m) => {
    const provider = providerFromModelId(m.modelId);
    return {
      provider,
      modelId: m.modelId,
      displayName: m.displayName,
      inputPer1kToman: m.inputPer1kToman,
      outputPer1kToman: m.outputPer1kToman,
      contextWindow: m.contextWindow,
      tags: deriveTags(m.modelId, provider, m.outputPer1kToman, maxOutput[provider] ?? 0),
      enabled: true,
    } satisfies NewAiModelCatalogRow;
  });
}

/* ──────────────────────────────  upsert  ────────────────────────────────── */

/** ردیف‌ها را بر اساسِ modelId در کاتالوگ upsert می‌کند (idempotent). */
async function upsertRows(
  rows: NewAiModelCatalogRow[],
  db: CatalogDb,
): Promise<number> {
  if (rows.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    await db
      .insert(aiModelCatalog)
      .values(row)
      .onConflictDoUpdate({
        target: aiModelCatalog.modelId,
        set: {
          provider: row.provider,
          displayName: row.displayName,
          inputPer1kToman: row.inputPer1kToman,
          outputPer1kToman: row.outputPer1kToman,
          contextWindow: row.contextWindow ?? null,
          tags: row.tags ?? [],
          enabled: row.enabled ?? true,
          syncedAt: new Date(),
        },
      });
    count += 1;
  }
  return count;
}

/**
 * کاتالوگ را با مدل‌های SEED پر می‌کند — منبعِ مطمئنِ «هرگز خالی نباشد».
 * این تابع را در migration/bootstrap صدا بزنید تا کاربر بتواند مدل انتخاب کند.
 */
export async function seedModelCatalog(
  db: CatalogDb = defaultDb,
): Promise<{ upserted: number }> {
  const upserted = await upsertRows(toCatalogRows(SEED_MODELS), db);
  return { upserted };
}

/* ──────────────────────────  همگام‌سازیِ زنده  ──────────────────────────── */

/** origin گیت‌وی را از ONEXAI_BASE_URL می‌گیرد (با حذفِ پسوندِ /v1 و اسلشِ پایانی). */
function gatewayOrigin(): string | null {
  const base = env.ONEXAI_BASE_URL;
  if (!base) return null;
  return base.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * شکلِ منعطفِ یک ردیفِ قیمت از اندپوینتِ /pricing را به SeedModel نگاشت می‌کند.
 * چون شکلِ دقیقِ گیت‌وی ممکن است فرق کند، چند نامِ فیلدِ محتمل را تحمل می‌کنیم؛ اگر
 * فیلدهای حیاتی (modelId + قیمت‌ها) نبود، null برمی‌گردانیم تا این ردیف رد شود.
 */
function pricingEntryToModel(entry: unknown): SeedModel | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;

  const modelId =
    str(e.id) ?? str(e.model) ?? str(e.modelId) ?? str(e.name);
  if (!modelId) return null;

  const inputPer1kToman =
    num(e.inputPer1kToman) ?? num(e.input_per_1k_toman) ?? num(e.input) ?? num(e.prompt);
  const outputPer1kToman =
    num(e.outputPer1kToman) ?? num(e.output_per_1k_toman) ?? num(e.output) ?? num(e.completion);
  if (inputPer1kToman == null || outputPer1kToman == null) return null;

  const contextWindow =
    num(e.contextWindow) ?? num(e.context_window) ?? num(e.context) ?? 0;
  const displayName = str(e.displayName) ?? str(e.display_name) ?? modelId;

  return {
    modelId,
    displayName,
    inputPer1kToman,
    outputPer1kToman,
    contextWindow: contextWindow ?? 0,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** نتیجه‌ی همگام‌سازی — منبعِ به‌کاررفته و تعدادِ ردیفِ upsertشده. */
export interface SyncResult {
  source: "live" | "seed";
  upserted: number;
}

/** آپشن‌های همگام‌سازی — تزریقِ fetch/origin برای تستِ بدونِ شبکه/env. */
export interface SyncOptions {
  fetchImpl?: CatalogFetch;
  /** بازنویسیِ origin گیت‌وی (پیش‌فرض از ONEXAI_BASE_URL با حذفِ /v1). */
  origin?: string;
}

/**
 * کاتالوگ را با گیت‌وی همگام می‌کند:
 *   ۱) تلاش برای GET {origin}/pricing (قیمتِ زنده). اگر موفق و غیرخالی بود → upsert.
 *   ۲) در هر شکستِ شبکه/پارس/خالی‌بودن → سقوط به SEED.
 *
 * هرگز throw نمی‌کند بابتِ در دسترس نبودنِ گیت‌وی؛ همیشه کاتالوگِ غیرخالی تضمین می‌شود.
 */
export async function syncModelCatalog(
  db: CatalogDb = defaultDb,
  fetchImpl?: CatalogFetch,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const origin = options.origin ?? gatewayOrigin();
  const doFetch =
    (options.fetchImpl ?? fetchImpl ?? (globalThis.fetch as unknown as CatalogFetch)) ?? null;

  if (origin && doFetch) {
    try {
      const headers: Record<string, string> = {};
      if (env.ONEXAI_API_KEY) headers.authorization = `Bearer ${env.ONEXAI_API_KEY}`;

      const res = await doFetch(`${origin}/pricing`, { headers });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        const entries = extractEntries(body);
        const models = entries
          .map(pricingEntryToModel)
          .filter((m): m is SeedModel => m !== null);
        if (models.length > 0) {
          const upserted = await upsertRows(toCatalogRows(models), db);
          return { source: "live", upserted };
        }
      }
    } catch {
      // هر خطا → سقوط به seed.
    }
  }

  // واپسین چاره: seed (کاتالوگ هرگز خالی نمی‌ماند).
  const { upserted } = await seedModelCatalog(db);
  return { source: "seed", upserted };
}

/** آرایه‌ی ردیف‌ها را از شکل‌های محتملِ پاسخ بیرون می‌کشد ({data:[]} | {pricing:[]} | []). */
function extractEntries(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.pricing)) return o.pricing;
    if (Array.isArray(o.models)) return o.models;
  }
  return [];
}
