/**
 * تست‌های مترینگ — با گیت‌وی mock (fetch تزریقی)، storeِ in-memory، و تزریقِ
 * resolveModel/priceFor/entitlement/ensureApiKey. بدونِ DB و بدونِ شبکه.
 *
 * تضمین‌های کلیدی که قفل می‌شوند (مدلِ کیف‌پولِ واحدِ 1xai):
 *   • گیتِ موجودی *پیش از* فراخوانیِ گیت‌وی (موجودیِ ناکافی ⇒ هیچ فراخوانی، هیچ کلید،
 *     هیچ رکوردی).
 *   • فراخوانیِ گیت‌وی با کلیدِ 1xaiِ *خودِ کاربر* انجام می‌شود (Authorization: Bearer)
 *     — 1xai خودش با نرخِ کاربر متر می‌کند.
 *   • *هیچ* کسرِ کیف‌پولِ محلی/حاشیه‌ای وجود ندارد؛ هزینه‌ی ثبت‌شده تخمینِ نرخِ لیست
 *     است (marginPct = ۰، cost = upstream) و فقط usage_record نوشته می‌شود.
 *   • خطای گیت‌وی ⇒ هیچ رکوردی (no record on error).
 */
import { describe, expect, it, vi } from "vitest";

import {
  meteredChatJson,
  meteredChat,
  drizzleMeteringStore,
  inMemoryMeteringStore,
  type MeteringDb,
  type MeteringOptions,
} from "@/lib/billing/metering";
import { AiMaintenanceError, InsufficientBalanceError } from "@/lib/billing/errors";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";
import { appAiBudget, usageRecords } from "@/db/schema";
import type { FetchLike, GatewayConfig } from "@/lib/ai/gateway";
import type { ModelPrice } from "@/lib/billing/pricing";

const CONFIG: GatewayConfig = {
  baseUrl: "https://gw.example/v1",
  apiKey: "sk-karjoo-env-key",
  model: "gpt-4o-mini",
};

const USER_KEY = "sk-1xai-user-own-key";

const PRICE: ModelPrice = {
  modelId: "gpt-4o-mini",
  provider: "openai",
  inputPer1kToman: 100,
  outputPer1kToman: 400,
};

/** fetchِ mock با content و usage دلخواه. */
function fetchReturning(
  content: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | null,
  opts: { ok?: boolean; status?: number } = {},
): FetchLike {
  return vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: async () =>
      JSON.stringify({
        model: "gpt-4o-mini",
        choices: [{ message: { role: "assistant", content } }],
        ...(usage ? { usage } : {}),
      }),
  }));
}

/** هدرِ authorizationِ اولین فراخوانیِ fetchِ mock را برمی‌گرداند. */
function sentAuthHeader(fetchImpl: FetchLike): string | undefined {
  const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
    | RequestInit
    | undefined;
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

/** آپشن‌های پایه‌ی مترینگ با همه‌چیز تزریق‌شده (بدونِ DB و بدونِ svc). */
function baseOpts(over: Partial<MeteringOptions> = {}): MeteringOptions {
  return {
    resolveModel: async () => ({ modelId: "gpt-4o-mini", provider: "openai" }),
    priceFor: async () => PRICE,
    entitlement: { readPlan: async () => "payg", readBalance: async () => 5000 },
    ensureApiKey: async () => USER_KEY,
    // گاردِ بودجه‌ی سراسری را در دسترس فرض می‌کنیم (تستِ نگه‌داری جداست).
    assertAiAvailable: async () => {},
    ...over,
  };
}

describe("meteredChatJson — مسیرِ موفق", () => {
  it("با کلیدِ خودِ کاربر صدا می‌زند، هزینه‌ی تخمینی را با نرخِ لیست (بدونِ حاشیه) ثبت می‌کند", async () => {
    const store = inMemoryMeteringStore();
    const ensureApiKey = vi.fn(async () => USER_KEY);
    const fetchImpl = fetchReturning(
      JSON.stringify({ ok: true }),
      { prompt_tokens: 2000, completion_tokens: 1000 },
    );

    const out = await meteredChatJson(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, ensureApiKey, gateway: { config: CONFIG, fetchImpl } }),
    );

    // ۲۰۰۰×۱۰۰/۱۰۰۰ + ۱۰۰۰×۴۰۰/۱۰۰۰ = ۶۰۰ — تخمینِ نرخِ لیست؛ حاشیه ۰ ⇒ cost = upstream.
    expect(out.charge.upstreamCostToman).toBe(600);
    expect(out.charge.costToman).toBe(600);
    expect(out.charge.modelId).toBe("gpt-4o-mini");
    expect(out.charge.provider).toBe("openai");

    // usage_record برای گاردریلِ بودجه/تاریخچه ثبت شده — با حاشیه‌ی صفر.
    expect(store.usage).toHaveLength(1);
    expect(store.usage[0]).toMatchObject({
      kind: "match",
      upstreamCostToman: 600,
      costToman: 600,
      marginPct: 0,
    });

    // فراخوانی با Bearerِ کلیدِ *خودِ کاربر* — نه کلیدِ envِ کارجو.
    expect(ensureApiKey).toHaveBeenCalledOnce();
    expect(ensureApiKey).toHaveBeenCalledWith("u1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sentAuthHeader(fetchImpl)).toBe(`Bearer ${USER_KEY}`);

    // data از خروجیِ JSONِ مدل پارس شده.
    expect(out.result.data).toEqual({ ok: true });
  });

  it("اگر گیت‌وی usage گزارش نکند، هزینه‌ی تخمینی ۰ ولی usage_record باز هم ثبت می‌شود", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning(JSON.stringify({ ok: true }), null);

    const out = await meteredChatJson(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, gateway: { config: CONFIG, fetchImpl } }),
    );
    expect(out.charge.costToman).toBe(0);
    // usage_record باز هم برای حسابرسی ثبت می‌شود.
    expect(store.usage).toHaveLength(1);
  });
});

describe("meteredChat — گیتِ بیلینگ (کیف‌پولِ واحد)", () => {
  it("موجودیِ ناکافی ⇒ InsufficientBalanceError، *هیچ فراخوانی* و *هیچ کلیدی*", async () => {
    const store = inMemoryMeteringStore();
    const ensureApiKey = vi.fn(async () => USER_KEY);
    const fetchImpl = fetchReturning("نباید صدا شود", { prompt_tokens: 1 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        store,
        ensureApiKey,
        gateway: { config: CONFIG, fetchImpl },
        entitlement: { readPlan: async () => "payg", readBalance: async () => 0 },
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(fetchImpl).not.toHaveBeenCalled(); // گیت پیش از فراخوانی.
    expect(ensureApiKey).not.toHaveBeenCalled(); // برای کاربرِ بی‌موجودی کلیدی صادر نمی‌شود.
    expect(store.usage).toHaveLength(0); // هیچ رکوردی.
  });

  it("پلنِ free با موجودیِ صفر ⇒ InsufficientBalanceError و هیچ فراخوانی", async () => {
    const fetchImpl = fetchReturning("x", { prompt_tokens: 1 });
    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        gateway: { config: CONFIG, fetchImpl },
        entitlement: { readPlan: async () => "free", readBalance: async () => 0 },
      }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("پلنِ free با موجودیِ مثبت ⇒ مجاز (گیت روی موجودی است، نه پلن)", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning(JSON.stringify({ ok: true }), {
      prompt_tokens: 1000,
      completion_tokens: 0,
    });
    const out = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        store,
        gateway: { config: CONFIG, fetchImpl },
        entitlement: { readPlan: async () => "free", readBalance: async () => 5000 },
      }),
    );
    expect(out.charge.costToman).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("svcِ 1xai در دسترس نیست ⇒ OnexaiSvcUnavailableError propagate و *هیچ فراخوانی* (fail-closed)", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning("نباید صدا شود", { prompt_tokens: 1 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        store,
        gateway: { config: CONFIG, fetchImpl },
        entitlement: {
          readPlan: async () => "payg",
          readBalance: async () => {
            throw new OnexaiSvcUnavailableError();
          },
        },
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(OnexaiSvcUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.usage).toHaveLength(0);
  });
});

describe("meteredChat — خطای گیت‌وی ⇒ بدونِ رکورد", () => {
  it("اگر گیت‌وی HTTP خطا بدهد، هیچ usage_record ثبت نمی‌شود", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning("boom", { prompt_tokens: 1 }, { ok: false, status: 500 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, gateway: { config: CONFIG, fetchImpl } }),
    ).catch((e) => e);

    expect(err).toBeDefined();
    expect(store.usage).toHaveLength(0);
  });
});

describe("meteredChat — حالتِ نگه‌داریِ بودجه‌ی سراسری", () => {
  it("اگر AiMaintenanceError ⇒ هیچ فراخوانیِ گیت‌وی و هیچ رکوردی", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning("نباید صدا شود", { prompt_tokens: 1 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        store,
        gateway: { config: CONFIG, fetchImpl },
        // گاردِ بودجه نگه‌داری را اعلام می‌کند (سقفِ ماهانه رسیده).
        assertAiAvailable: async () => {
          throw new AiMaintenanceError({ manual: false });
        },
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(AiMaintenanceError);
    expect((err as AiMaintenanceError).code).toBe("ai_maintenance");
    expect(fetchImpl).not.toHaveBeenCalled(); // پیش از فراخوانی بلاک شد.
    expect(store.usage).toHaveLength(0); // هیچ رکوردی.
  });
});

describe("resolveModel — مدلِ صریح", () => {
  it("اگر req.model داده شود، provider از پیشوندِ نام استنتاج می‌شود و همان مدل صدا می‌زند", async () => {
    const store = inMemoryMeteringStore();
    const fetchImpl = fetchReturning(JSON.stringify({ ok: true }), {
      prompt_tokens: 1000,
      completion_tokens: 0,
    });
    // resolveModel را تزریق نمی‌کنیم تا مسیرِ «model صریح» تست شود؛ priceFor تزریقی.
    const out = await meteredChatJson(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }], model: "claude-3-5-haiku" },
      {
        priceFor: async () => ({
          modelId: "claude-3-5-haiku",
          provider: "anthropic",
          inputPer1kToman: 500,
          outputPer1kToman: 2500,
        }),
        entitlement: { readPlan: async () => "premium", readBalance: async () => 100_000 },
        ensureApiKey: async () => USER_KEY,
        assertAiAvailable: async () => {},
        store,
        gateway: { config: CONFIG, fetchImpl },
      },
    );
    expect(out.charge.modelId).toBe("claude-3-5-haiku");
    expect(out.charge.provider).toBe("anthropic");
    // ۱۰۰۰×۵۰۰/۱۰۰۰ = ۵۰۰ — نرخِ لیست، بدونِ حاشیه.
    expect(out.charge.costToman).toBe(500);
  });
});

describe("drizzleMeteringStore — فقط usage_record + شمارنده‌ی بودجه، *هیچ* کسرِ کیف‌پول", () => {
  /** dbِ جعلی که هر insert/update داخلِ تراکنش را ضبط می‌کند. */
  function fakeDb() {
    const insertedTables: unknown[] = [];
    const insertedValues: unknown[] = [];
    const updateCalls: unknown[] = [];

    const tx = {
      insert(table: unknown) {
        return {
          values(vals: unknown) {
            insertedTables.push(table);
            insertedValues.push(vals);
            return {
              async onConflictDoUpdate() {},
              async returning() {
                return [{ id: "usage-row-1" }];
              },
            };
          },
        };
      },
      // اگر مترینگ هنوز به کیف‌پولِ محلی دست بزند، این‌جا لو می‌رود.
      update(table: unknown) {
        updateCalls.push(table);
        throw new Error("کسرِ کیف‌پولِ محلی دیگر نباید اتفاق بیفتد");
      },
    };

    const db = {
      transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    } as unknown as MeteringDb;

    return { db, insertedTables, insertedValues, updateCalls };
  }

  it("settle فقط شمارنده‌ی بودجه و usage_records را می‌نویسد (بدونِ update/ledger)", async () => {
    const { db, insertedTables, insertedValues, updateCalls } = fakeDb();
    const store = drizzleMeteringStore(db);

    const out = await store.settle({
      userId: "u1",
      kind: "match",
      provider: "openai",
      modelId: "gpt-4o-mini",
      promptTokens: 2000,
      completionTokens: 1000,
      upstreamCostToman: 600,
      marginPct: 0,
      costToman: 600,
      now: Date.UTC(2026, 6, 1),
    });

    expect(out).toEqual({ usageRecordId: "usage-row-1" });
    // دقیقاً دو insert: شمارنده‌ی بودجه‌ی ماه + usage_record — و نه هیچ جدولِ دیگری.
    expect(insertedTables).toEqual([appAiBudget, usageRecords]);
    expect(insertedValues[1]).toMatchObject({
      userId: "u1",
      costToman: 600,
      upstreamCostToman: 600,
      marginPct: 0,
    });
    // *هیچ* UPDATEای (کسرِ wallets) و هیچ insertِ walletLedger انجام نشده.
    expect(updateCalls).toHaveLength(0);
  });

  it("هزینه‌ی صفر ⇒ شمارنده‌ی بودجه no-op و فقط usage_record", async () => {
    const { db, insertedTables, updateCalls } = fakeDb();
    const store = drizzleMeteringStore(db);

    await store.settle({
      userId: "u1",
      kind: "match",
      provider: "openai",
      modelId: "gpt-4o-mini",
      promptTokens: 0,
      completionTokens: 0,
      upstreamCostToman: 0,
      marginPct: 0,
      costToman: 0,
      now: Date.UTC(2026, 6, 1),
    });

    expect(insertedTables).toEqual([usageRecords]);
    expect(updateCalls).toHaveLength(0);
  });
});
