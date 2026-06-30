/**
 * تست‌های کاتالوگ‌سینک — seed، برچسب‌گذاری، و سقوط به seed هنگامِ خطای/خالیِ live.
 * بدونِ DB و بدونِ شبکه (insert و fetch تزریق می‌شوند).
 */
import { describe, expect, it, vi } from "vitest";

import {
  seedModelCatalog,
  syncModelCatalog,
  SEED_MODELS,
  type CatalogDb,
  type CatalogFetch,
} from "@/lib/billing/catalog-sync";
import type { NewAiModelCatalogRow } from "@/db/schema";

/** fakeِ insert که ردیف‌های upsertشده را ثبت می‌کند. */
function fakeCatalogDb(): { db: CatalogDb; rows: NewAiModelCatalogRow[] } {
  const rows: NewAiModelCatalogRow[] = [];
  const db = {
    insert: () => ({
      values: (v: NewAiModelCatalogRow) => ({
        onConflictDoUpdate: async () => {
          rows.push(v);
          return undefined;
        },
      }),
    }),
  } as unknown as CatalogDb;
  return { db, rows };
}

describe("seedModelCatalog", () => {
  it("همه‌ی مدل‌های SEED را upsert می‌کند", async () => {
    const { db, rows } = fakeCatalogDb();
    const { upserted } = await seedModelCatalog(db);
    expect(upserted).toBe(SEED_MODELS.length);
    expect(rows.length).toBe(SEED_MODELS.length);
  });

  it("provider را از پیشوندِ نامِ مدل استنتاج می‌کند", async () => {
    const { db, rows } = fakeCatalogDb();
    await seedModelCatalog(db);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    expect(byId.get("gpt-4o-mini")?.provider).toBe("openai");
    expect(byId.get("claude-3-5-haiku")?.provider).toBe("anthropic");
    expect(byId.get("gemini-2.5-pro")?.provider).toBe("google");
  });

  it("برچسب‌ها را درست مشتق می‌کند (recommended/cheap/fast/premium/persian)", async () => {
    const { db, rows } = fakeCatalogDb();
    await seedModelCatalog(db);
    const byId = new Map(rows.map((r) => [r.modelId, r.tags ?? []]));

    // recommended به‌ازای هر provider.
    expect(byId.get("gpt-4o-mini")).toContain("recommended");
    expect(byId.get("claude-3-5-haiku")).toContain("recommended");
    expect(byId.get("gemini-2.5-flash")).toContain("recommended");

    // cheap/fast برای mini/flash/haiku/lite.
    expect(byId.get("gpt-4o-mini")).toContain("cheap");
    expect(byId.get("gpt-4o-mini")).toContain("fast");

    // premium = گران‌ترینِ هر provider (بر اساسِ outputِ تومان).
    expect(byId.get("gpt-5")).toContain("premium");
    expect(byId.get("claude-opus-4-7")).toContain("premium");
    expect(byId.get("gemini-2.5-pro")).toContain("premium");

    // persian برای خانواده‌ی claude/gpt.
    expect(byId.get("gpt-4o-mini")).toContain("persian");
    expect(byId.get("claude-3-5-haiku")).toContain("persian");
    expect(byId.get("gemini-2.5-pro")).not.toContain("persian");
  });
});

describe("syncModelCatalog", () => {
  it("اگر /pricing زنده و غیرخالی بدهد، از منبعِ live upsert می‌کند", async () => {
    const { db, rows } = fakeCatalogDb();
    const fetchImpl: CatalogFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "gpt-4o-mini", inputPer1kToman: 95, outputPer1kToman: 380, context_window: 128000 },
          { id: "claude-3-5-haiku", input: 500, output: 2500 },
        ],
      }),
      text: async () => "",
    }));

    const res = await syncModelCatalog(db, fetchImpl, { origin: "http://gw.example" });
    expect(res.source).toBe("live");
    expect(res.upserted).toBe(2);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    expect(byId.get("gpt-4o-mini")?.inputPer1kToman).toBe(95);
  });

  it("اگر /pricing خطا بدهد، به SEED سقوط می‌کند", async () => {
    const { db, rows } = fakeCatalogDb();
    const fetchImpl: CatalogFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const res = await syncModelCatalog(db, fetchImpl, { origin: "http://gw.example" });
    expect(res.source).toBe("seed");
    expect(rows.length).toBe(SEED_MODELS.length);
  });

  it("اگر /pricing خالی برگرداند، به SEED سقوط می‌کند", async () => {
    const { db } = fakeCatalogDb();
    const fetchImpl: CatalogFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => "",
    }));
    const res = await syncModelCatalog(db, fetchImpl, { origin: "http://gw.example" });
    expect(res.source).toBe("seed");
  });
});
