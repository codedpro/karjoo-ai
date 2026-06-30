/**
 * تست‌های لایه‌ی store (کاتالوگ + تنظیماتِ کاربر) — Track A.
 *
 * توابعِ خالص (groupByProvider/recommendedModelId) مستقیم تست می‌شوند. توابعِ
 * DB-محور با یک fakeِ سبکِ Drizzle تزریق می‌شوند تا بدونِ DB/شبکه اجرا شوند: fake
 * بر اساسِ جدولِ هدف (.from) نتیجه‌ی برنامه‌ریزی‌شده را برمی‌گرداند و فراخوانی‌های
 * insert را ثبت می‌کند تا upsertِ تنظیمات (و اعتبارسنجیِ مدلِ enabled) راستی‌آزمایی شود.
 */
import { describe, expect, it, vi } from "vitest";

import { aiModelCatalog, userAiSettings } from "@/db/schema";
import {
  getEnabledCatalog,
  getUserModelSelection,
  groupByProvider,
  recommendedModelId,
  setUserModel,
  type CatalogModel,
} from "@/lib/ai-settings/store";

/* ───────────────────────────  fakeِ سبکِ Drizzle  ───────────────────────── */

type Rows = Record<string, unknown>[];

/**
 * یک fakeِ کمینه که فقط زنجیره‌های استفاده‌شده در store را پشتیبانی می‌کند:
 *   select(...).from(table).where(...).orderBy(...)         → resolves
 *   select(...).from(table).where(...).limit(n)             → resolves
 *   insert(table).values(...).onConflictDoUpdate(...)       → resolves
 * نتیجه‌ی select بر اساسِ هویتِ جدول (.from) از `tableResults` گرفته می‌شود.
 */
function makeFakeDb(tableResults: Map<unknown, Rows>) {
  const inserts: { table: unknown; values: unknown; conflict?: unknown }[] = [];

  function selectBuilder() {
    let currentTable: unknown = null;
    const builder: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(tableResults.get(currentTable) ?? []);
    builder.from = (table: unknown) => {
      currentTable = table;
      return builder;
    };
    builder.where = () => builder;
    builder.orderBy = () => resolve();
    builder.limit = () => resolve();
    return builder;
  }

  const db = {
    select: () => selectBuilder(),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (conflict: unknown) => {
          inserts.push({ table, values, conflict });
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  return { db, inserts };
}

const CATALOG_ROWS: Rows = [
  {
    modelId: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    inputPer1kToman: 90,
    outputPer1kToman: 360,
    contextWindow: 128_000,
    tags: ["recommended", "cheap", "fast", "persian"],
  },
  {
    modelId: "gpt-5",
    provider: "openai",
    displayName: "GPT-5",
    inputPer1kToman: 1_600,
    outputPer1kToman: 12_800,
    contextWindow: 256_000,
    tags: ["premium", "persian"],
  },
  {
    modelId: "gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    inputPer1kToman: 180,
    outputPer1kToman: 1_500,
    contextWindow: 1_000_000,
    tags: ["recommended", "cheap", "fast"],
  },
];

/* ───────────────────────────  توابعِ خالص  ──────────────────────────────── */

const SAMPLE: CatalogModel[] = [
  { modelId: "gpt-4o-mini", provider: "openai", displayName: "GPT-4o mini", inputPer1kToman: 90, outputPer1kToman: 360, contextWindow: 128_000, tags: ["recommended"] },
  { modelId: "gpt-5", provider: "openai", displayName: "GPT-5", inputPer1kToman: 1_600, outputPer1kToman: 12_800, contextWindow: 256_000, tags: ["premium"] },
  { modelId: "gemini-2.5-flash", provider: "google", displayName: "Gemini 2.5 Flash", inputPer1kToman: 180, outputPer1kToman: 1_500, contextWindow: 1_000_000, tags: ["recommended"] },
];

describe("groupByProvider", () => {
  it("بر اساسِ provider به ترتیبِ openai→anthropic→google گروه می‌کند", () => {
    const groups = groupByProvider(SAMPLE);
    expect(groups.map((g) => g.provider)).toEqual(["openai", "google"]);
    // openai دو مدل، google یک مدل.
    expect(groups[0].models).toHaveLength(2);
    expect(groups[1].models).toHaveLength(1);
    expect(groups[0].label).toBe("OpenAI");
  });

  it("provider بدونِ مدل، گروه نمی‌سازد (تبِ خالی نمایش داده نمی‌شود)", () => {
    const onlyGoogle = SAMPLE.filter((m) => m.provider === "google");
    const groups = groupByProvider(onlyGoogle);
    expect(groups).toHaveLength(1);
    expect(groups[0].provider).toBe("google");
  });

  it("ورودیِ خالی → آرایه‌ی خالی", () => {
    expect(groupByProvider([])).toEqual([]);
  });
});

describe("recommendedModelId", () => {
  it("اولین مدلِ دارای برچسبِ recommended را برمی‌گرداند", () => {
    expect(recommendedModelId(SAMPLE)).toBe("gpt-4o-mini");
  });

  it("اگر هیچ مدلی recommended نبود → اولین مدل", () => {
    const none = SAMPLE.map((m) => ({ ...m, tags: [] as string[] }));
    expect(recommendedModelId(none)).toBe("gpt-4o-mini");
  });

  it("کاتالوگِ خالی → null", () => {
    expect(recommendedModelId([])).toBeNull();
  });
});

/* ───────────────────────────  getEnabledCatalog  ────────────────────────── */

describe("getEnabledCatalog", () => {
  it("ردیف‌های کاتالوگ را به CatalogModel نگاشت می‌کند (contextWindow null-safe)", async () => {
    const rows: Rows = [
      { ...CATALOG_ROWS[0], contextWindow: null, tags: null },
    ];
    const { db } = makeFakeDb(new Map([[aiModelCatalog, rows]]));
    const out = await getEnabledCatalog(db as never);
    expect(out).toHaveLength(1);
    expect(out[0].modelId).toBe("gpt-4o-mini");
    expect(out[0].contextWindow).toBeNull();
    expect(out[0].tags).toEqual([]);
  });
});

/* ─────────────────────────  getUserModelSelection  ──────────────────────── */

describe("getUserModelSelection", () => {
  it("مدلِ صریحِ کاربر (اگر هنوز enabled باشد) → isDefault=false", async () => {
    const { db } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, CATALOG_ROWS],
        [userAiSettings, [{ provider: "openai", modelId: "gpt-5" }]],
      ]),
    );
    const sel = await getUserModelSelection("u1", db as never);
    expect(sel).toEqual({ provider: "openai", modelId: "gpt-5", isDefault: false });
  });

  it("اگر کاربر انتخابی نکرده → پیش‌فرضِ recommended با isDefault=true", async () => {
    const { db } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, CATALOG_ROWS],
        [userAiSettings, []],
      ]),
    );
    const sel = await getUserModelSelection("u1", db as never);
    // اولین مدلِ recommended در ترتیبِ کاتالوگ = gpt-4o-mini.
    expect(sel).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
      isDefault: true,
    });
  });

  it("اگر مدلِ انتخابیِ کاربر دیگر فعال نباشد → به recommended برمی‌گردد", async () => {
    const { db } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, CATALOG_ROWS],
        // کاربر مدلی انتخاب کرده که در کاتالوگِ فعال نیست.
        [userAiSettings, [{ provider: "anthropic", modelId: "claude-opus-4-7" }]],
      ]),
    );
    const sel = await getUserModelSelection("u1", db as never);
    expect(sel?.modelId).toBe("gpt-4o-mini");
    expect(sel?.isDefault).toBe(true);
  });

  it("کاتالوگِ خالی → null", async () => {
    const { db } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, []],
        [userAiSettings, []],
      ]),
    );
    expect(await getUserModelSelection("u1", db as never)).toBeNull();
  });
});

/* ───────────────────────────────  setUserModel  ─────────────────────────── */

describe("setUserModel", () => {
  it("مدلِ معتبرِ enabled → upsert با provider از کاتالوگ", async () => {
    const { db, inserts } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, [{ provider: "openai", modelId: "gpt-4o-mini" }]],
      ]),
    );
    const now = () => new Date("2026-06-30T00:00:00Z");
    const res = await setUserModel("u1", "gpt-4o-mini", db as never, now);
    expect(res).toEqual({
      ok: true,
      selection: { provider: "openai", modelId: "gpt-4o-mini" },
    });
    // یک upsert با userId/provider/modelId درست.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(userAiSettings);
    expect(inserts[0].values).toMatchObject({
      userId: "u1",
      provider: "openai",
      modelId: "gpt-4o-mini",
    });
  });

  it("مدلِ ناشناخته/غیرفعال → model_not_found و هیچ نوشتن", async () => {
    const { db, inserts } = makeFakeDb(
      new Map<unknown, Rows>([[aiModelCatalog, []]]),
    );
    const res = await setUserModel("u1", "bogus", db as never);
    expect(res).toEqual({ ok: false, reason: "model_not_found" });
    expect(inserts).toHaveLength(0);
  });

  it("provider همیشه از کاتالوگ می‌آید (نه از فراخواننده) — هم‌خوان با گیت‌وی", async () => {
    const { db, inserts } = makeFakeDb(
      new Map<unknown, Rows>([
        [aiModelCatalog, [{ provider: "google", modelId: "gemini-2.5-flash" }]],
      ]),
    );
    await setUserModel("u1", "gemini-2.5-flash", db as never);
    expect(inserts[0].values).toMatchObject({ provider: "google" });
  });
});

/* یک smoke تا importهای استفاده‌نشده هشدار ندهند. */
it("vi در دسترس است", () => {
  expect(vi).toBeTruthy();
});
