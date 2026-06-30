/**
 * تست‌های قیمت‌گذاری/محاسبه‌ی هزینه — بدونِ DB و بدونِ شبکه.
 *
 * computeCostFromPrice تابعِ خالص است؛ priceFor با یک fakeِ سبکِ select تست می‌شود.
 */
import { describe, expect, it } from "vitest";

import {
  computeCostFromPrice,
  priceFor,
  type ModelPrice,
  type PricingDb,
} from "@/lib/billing/pricing";
import { ModelNotFoundError } from "@/lib/billing/errors";

const PRICE: ModelPrice = {
  modelId: "gpt-4o-mini",
  provider: "openai",
  inputPer1kToman: 100,
  outputPer1kToman: 400,
};

describe("computeCostFromPrice", () => {
  it("هزینه‌ی بالادست و نهایی را درست (با حاشیه) محاسبه می‌کند", () => {
    // ۲۰۰۰ promptِ ورودی × ۱۰۰/۱۰۰۰ = ۲۰۰؛ ۱۰۰۰ خروجی × ۴۰۰/۱۰۰۰ = ۴۰۰ ⇒ بالادست ۶۰۰.
    const { upstreamCostToman, costToman } = computeCostFromPrice(2000, 1000, PRICE, 20);
    expect(upstreamCostToman).toBe(600);
    // با حاشیه‌ی ۲۰٪ ⇒ ۷۲۰.
    expect(costToman).toBe(720);
  });

  it("حاشیه‌ی صفر ⇒ هزینه‌ی نهایی برابرِ بالادست", () => {
    const { upstreamCostToman, costToman } = computeCostFromPrice(1000, 0, PRICE, 0);
    expect(upstreamCostToman).toBe(100);
    expect(costToman).toBe(100);
  });

  it("توکنِ منفی/خالی را امن می‌گیرد (۰)", () => {
    const c = computeCostFromPrice(-5, NaN as unknown as number, PRICE, 20);
    expect(c.upstreamCostToman).toBe(0);
    expect(c.costToman).toBe(0);
  });

  it("نتیجه را گرد می‌کند (عددِ صحیحِ تومان)", () => {
    // ۱ تنها توکنِ ورودی × ۱۰۰/۱۰۰۰ = ۰٫۱ ⇒ گرد ⇒ ۰؛ با حاشیه هم ۰.
    const c = computeCostFromPrice(1, 0, PRICE, 20);
    expect(Number.isInteger(c.upstreamCostToman)).toBe(true);
    expect(Number.isInteger(c.costToman)).toBe(true);
  });
});

/** fakeِ سبکِ select که زنجیره‌ی from→where→limit را تقلید می‌کند. */
function fakeSelectDb(rows: unknown[]): PricingDb {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as PricingDb;
}

describe("priceFor", () => {
  it("قیمتِ مدلِ موجود را برمی‌گرداند", async () => {
    const db = fakeSelectDb([PRICE]);
    const out = await priceFor("gpt-4o-mini", db);
    expect(out.modelId).toBe("gpt-4o-mini");
    expect(out.inputPer1kToman).toBe(100);
  });

  it("اگر مدل نبود ModelNotFoundError می‌دهد", async () => {
    const db = fakeSelectDb([]);
    const err = await priceFor("ghost-model", db).catch((e) => e);
    expect(err).toBeInstanceOf(ModelNotFoundError);
    expect((err as ModelNotFoundError).modelId).toBe("ghost-model");
  });
});
