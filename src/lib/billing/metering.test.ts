/**
 * تست‌های مترینگ — با گیت‌وی mock (fetch تزریقی)، storeِ in-memory، و تزریقِ
 * resolveModel/priceFor/entitlement. بدونِ DB و بدونِ شبکه.
 *
 * تضمین‌های کلیدی که قفل می‌شوند:
 *   • گیتِ موجودی *پیش از* فراخوانیِ گیت‌وی (موجودیِ ناکافی ⇒ هیچ فراخوانی، هیچ کسری).
 *   • خطای گیت‌وی ⇒ هیچ کسری (no charge on error).
 *   • موفقیت ⇒ usage_record + کسرِ هزینه‌ی واقعی (از usage × قیمت × حاشیه).
 */
import { describe, expect, it, vi } from "vitest";

import {
  meteredChatJson,
  meteredChat,
  inMemoryMeteringStore,
  type MeteringOptions,
} from "@/lib/billing/metering";
import { AiMaintenanceError, InsufficientBalanceError } from "@/lib/billing/errors";
import type { FetchLike, GatewayConfig } from "@/lib/ai/gateway";
import type { ModelPrice } from "@/lib/billing/pricing";

const CONFIG: GatewayConfig = {
  baseUrl: "https://gw.example/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

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

/** آپشن‌های پایه‌ی مترینگ با همه‌چیز تزریق‌شده (بدونِ DB). */
function baseOpts(over: Partial<MeteringOptions> = {}): MeteringOptions {
  return {
    marginPct: 20,
    resolveModel: async () => ({ modelId: "gpt-4o-mini", provider: "openai" }),
    priceFor: async () => PRICE,
    entitlement: { readPlan: async () => "payg", readBalance: async () => 5000 },
    // گاردِ بودجه‌ی سراسری را در دسترس فرض می‌کنیم (تستِ نگه‌داری جداست).
    assertAiAvailable: async () => {},
    ...over,
  };
}

describe("meteredChatJson — مسیرِ موفق", () => {
  it("هزینه را از usage محاسبه، usage_record می‌سازد و کیف‌پول را کسر می‌کند", async () => {
    const store = inMemoryMeteringStore({ u1: 5000 });
    const fetchImpl = fetchReturning(
      JSON.stringify({ ok: true }),
      { prompt_tokens: 2000, completion_tokens: 1000 },
    );

    const out = await meteredChatJson(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, gateway: { config: CONFIG, fetchImpl } }),
    );

    // ۲۰۰۰×۱۰۰/۱۰۰۰ + ۱۰۰۰×۴۰۰/۱۰۰۰ = ۶۰۰ بالادست؛ ×۱٫۲ = ۷۲۰ نهایی.
    expect(out.charge.upstreamCostToman).toBe(600);
    expect(out.charge.costToman).toBe(720);
    expect(out.charge.balanceAfterToman).toBe(5000 - 720);
    expect(out.charge.modelId).toBe("gpt-4o-mini");
    expect(out.charge.provider).toBe("openai");
    expect(store.usage).toHaveLength(1);
    expect(store.usage[0]).toMatchObject({ kind: "match", costToman: 720 });
    // data از خروجیِ JSONِ مدل پارس شده.
    expect(out.result.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("اگر گیت‌وی usage گزارش نکند، هزینه ۰ و کیف‌پول دست‌نخورده می‌ماند", async () => {
    const store = inMemoryMeteringStore({ u1: 5000 });
    const fetchImpl = fetchReturning(JSON.stringify({ ok: true }), null);

    const out = await meteredChatJson(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, gateway: { config: CONFIG, fetchImpl } }),
    );
    expect(out.charge.costToman).toBe(0);
    expect(store.balances.get("u1")).toBe(5000);
    // usage_record باز هم برای حسابرسی ثبت می‌شود.
    expect(store.usage).toHaveLength(1);
  });
});

describe("meteredChat — گیتِ بیلینگ", () => {
  it("موجودیِ ناکافی ⇒ InsufficientBalanceError و *هیچ فراخوانیِ گیت‌وی*", async () => {
    const store = inMemoryMeteringStore({ u1: 0 });
    const fetchImpl = fetchReturning("نباید صدا شود", { prompt_tokens: 1 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({
        store,
        gateway: { config: CONFIG, fetchImpl },
        entitlement: { readPlan: async () => "payg", readBalance: async () => 0 },
      }),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect(fetchImpl).not.toHaveBeenCalled(); // گیت پیش از فراخوانی.
    expect(store.usage).toHaveLength(0); // هیچ کسری/رکوردی.
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
    const store = inMemoryMeteringStore({ u1: 5000 });
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
});

describe("meteredChat — خطای گیت‌وی ⇒ بدونِ کسر", () => {
  it("اگر گیت‌وی HTTP خطا بدهد، هیچ usage_record/کسری ثبت نمی‌شود", async () => {
    const store = inMemoryMeteringStore({ u1: 5000 });
    const fetchImpl = fetchReturning("boom", { prompt_tokens: 1 }, { ok: false, status: 500 });

    const err = await meteredChat(
      "u1",
      "match",
      { messages: [{ role: "user", content: "hi" }] },
      baseOpts({ store, gateway: { config: CONFIG, fetchImpl } }),
    ).catch((e) => e);

    expect(err).toBeDefined();
    expect(store.usage).toHaveLength(0);
    expect(store.balances.get("u1")).toBe(5000); // دست‌نخورده.
  });
});

describe("meteredChat — حالتِ نگه‌داریِ بودجه‌ی سراسری", () => {
  it("اگر AiMaintenanceError ⇒ هیچ فراخوانیِ گیت‌وی و هیچ کسری", async () => {
    const store = inMemoryMeteringStore({ u1: 5000 });
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
    expect(store.usage).toHaveLength(0); // هیچ رکورد/کسری.
    expect(store.balances.get("u1")).toBe(5000);
  });
});

describe("resolveModel — مدلِ صریح", () => {
  it("اگر req.model داده شود، provider از پیشوندِ نام استنتاج می‌شود و همان مدل صدا می‌زند", async () => {
    const store = inMemoryMeteringStore({ u1: 100_000 });
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
        marginPct: 0,
        priceFor: async () => ({
          modelId: "claude-3-5-haiku",
          provider: "anthropic",
          inputPer1kToman: 500,
          outputPer1kToman: 2500,
        }),
        entitlement: { readPlan: async () => "premium", readBalance: async () => 100_000 },
        assertAiAvailable: async () => {},
        store,
        gateway: { config: CONFIG, fetchImpl },
      },
    );
    expect(out.charge.modelId).toBe("claude-3-5-haiku");
    expect(out.charge.provider).toBe("anthropic");
    // ۱۰۰۰×۵۰۰/۱۰۰۰ = ۵۰۰، حاشیه ۰ ⇒ ۵۰۰.
    expect(out.charge.costToman).toBe(500);
  });
});
