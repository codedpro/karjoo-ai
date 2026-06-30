/**
 * تست‌های کمک‌کننده‌های UIِ بیلینگ (Track C) — همه خالص، بدونِ DB/شبکه.
 *
 * این لایه فقط محاسبه/قالب‌بندیِ نمایشی است؛ هیچ کسری/متری واقعی ندارد. تست‌ها تضمین
 * می‌کنند:
 *   • قالبِ تومان/ارقامِ فارسی درست باشد،
 *   • تخمینِ هزینه *هم‌سان* با منطقِ کسرِ واقعی (computeCostFromPrice) باشد،
 *   • تشخیصِ ۴۰۲ (نیازمندِ شارژ) فقط روی ۴۰۲ فعال شود،
 *   • readPaidActionResponse سه حالتِ موفق/شارژ/خطا را تمیز جدا کند.
 */
import { describe, expect, it } from "vitest";

import {
  ACTION_TOKEN_ESTIMATES,
  detectTopupNeeded,
  estimateActionCost,
  estimateCost,
  formatCostHint,
  formatToman,
  readPaidActionResponse,
  toFaDigits,
  TOPUP_NEEDED_MESSAGE,
  type UiModelPrice,
} from "@/lib/billing/ui";
import { computeCostFromPrice } from "@/lib/billing/pricing";

const PRICE: UiModelPrice = {
  modelId: "gpt-4o-mini",
  displayName: "GPT-4o mini",
  inputPer1kToman: 100,
  outputPer1kToman: 400,
};

describe("toFaDigits / formatToman", () => {
  it("ارقامِ لاتین را به فارسی نگاشت می‌کند", () => {
    expect(toFaDigits(123)).toBe("۱۲۳");
    expect(toFaDigits("a1b2")).toBe("a۱b۲");
  });

  it("تومان را با جداکننده و واحد قالب می‌کند", () => {
    expect(formatToman(12500)).toBe("۱۲٬۵۰۰ تومان");
  });

  it("بدونِ واحد قالب می‌کند وقتی withUnit=false", () => {
    expect(formatToman(12500, { withUnit: false })).toBe("۱۲٬۵۰۰");
  });

  it("مبلغِ منفی/نامعتبر را محتاطانه ۰ می‌کند", () => {
    expect(formatToman(-5)).toBe("۰ تومان");
    expect(formatToman(NaN)).toBe("۰ تومان");
  });

  it("مبلغِ اعشاری را گرد می‌کند", () => {
    expect(formatToman(99.6)).toBe("۱۰۰ تومان");
  });
});

describe("estimateCost", () => {
  it("هم‌سان با computeCostFromPrice محاسبه می‌کند (تخمین ≡ کسرِ واقعی)", () => {
    const est = estimateCost(PRICE, { promptTokens: 2000, completionTokens: 1000 }, 20);
    const real = computeCostFromPrice(2000, 1000, { ...PRICE, provider: "openai" }, 20);
    expect(est.upstreamToman).toBe(real.upstreamCostToman);
    expect(est.costToman).toBe(real.costToman);
    // ۲۰۰۰×۱۰۰/۱۰۰۰ + ۱۰۰۰×۴۰۰/۱۰۰۰ = ۶۰۰؛ با حاشیه‌ی ۲۰٪ ⇒ ۷۲۰.
    expect(est.upstreamToman).toBe(600);
    expect(est.costToman).toBe(720);
  });

  it("displayName را از price می‌گیرد، وگرنه modelId", () => {
    expect(estimateCost(PRICE, ACTION_TOKEN_ESTIMATES.match, 20).displayName).toBe(
      "GPT-4o mini",
    );
    const noName: UiModelPrice = { modelId: "x", inputPer1kToman: 1, outputPer1kToman: 1 };
    expect(estimateCost(noName, ACTION_TOKEN_ESTIMATES.match, 20).displayName).toBe("x");
  });

  it("توکن/حاشیه/قیمتِ منفی را امن می‌گیرد (۰)", () => {
    const est = estimateCost(
      { modelId: "x", inputPer1kToman: -10, outputPer1kToman: -10 },
      { promptTokens: -5, completionTokens: NaN as unknown as number },
      -3,
    );
    expect(est.upstreamToman).toBe(0);
    expect(est.costToman).toBe(0);
  });

  it("حاشیه‌ی صفر ⇒ هزینه‌ی نهایی برابرِ بالادست", () => {
    const est = estimateCost(PRICE, { promptTokens: 1000, completionTokens: 0 }, 0);
    expect(est.upstreamToman).toBe(100);
    expect(est.costToman).toBe(100);
  });
});

describe("estimateActionCost / formatCostHint", () => {
  it("برای هر کنشِ پولی تخمینِ مثبت می‌سازد", () => {
    for (const action of ["match", "cover_letter", "resume_parse"] as const) {
      const est = estimateActionCost(action, PRICE, 20);
      expect(est.costToman).toBeGreaterThan(0);
      expect(est.promptTokens).toBe(ACTION_TOKEN_ESTIMATES[action].promptTokens);
    }
  });

  it("کنشِ پولی‌تر (resume_parse) گران‌تر از match است", () => {
    const parse = estimateActionCost("resume_parse", PRICE, 20).costToman;
    const match = estimateActionCost("match", PRICE, 20).costToman;
    expect(parse).toBeGreaterThan(match);
  });

  it("متنِ «حدودِ هزینه» را با تومان فارسی می‌سازد", () => {
    const est = estimateCost(PRICE, { promptTokens: 2000, completionTokens: 1000 }, 20);
    expect(formatCostHint(est)).toBe("حدودِ ۷۲۰ تومان");
  });
});

describe("detectTopupNeeded", () => {
  it("روی ۴۰۲ با بدنه‌ی error، پیامِ سرور را برمی‌گرداند", () => {
    const out = detectTopupNeeded(402, { error: "شارژ کنید لطفاً" });
    expect(out).not.toBeNull();
    expect(out?.needsTopup).toBe(true);
    expect(out?.message).toBe("شارژ کنید لطفاً");
  });

  it("روی ۴۰۲ بدونِ بدنه‌ی معتبر، پیامِ پیش‌فرض را می‌دهد", () => {
    expect(detectTopupNeeded(402, null)?.message).toBe(TOPUP_NEEDED_MESSAGE);
    expect(detectTopupNeeded(402, { foo: 1 })?.message).toBe(TOPUP_NEEDED_MESSAGE);
  });

  it("روی کدهای غیر-۴۰۲ هرگز topup نمی‌دهد", () => {
    expect(detectTopupNeeded(200, { error: "x" })).toBeNull();
    expect(detectTopupNeeded(500, { error: "x" })).toBeNull();
    expect(detectTopupNeeded(401, { error: "x" })).toBeNull();
  });
});

/** یک Responseِ سبک که فقط ok/status/json را برای helper تقلید می‌کند. */
function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("readPaidActionResponse", () => {
  it("پاسخِ موفق را با data برمی‌گرداند", async () => {
    const out = await readPaidActionResponse<{ profile: { id: string } }>(
      fakeResponse(200, { profile: { id: "p1" } }),
    );
    expect(out.ok).toBe(true);
    expect(out.data?.profile.id).toBe("p1");
    expect(out.topup).toBeUndefined();
  });

  it("۴۰۲ را به topup تبدیل می‌کند (نه خطای ساده)", async () => {
    const out = await readPaidActionResponse(
      fakeResponse(402, { error: "موجودی کافی نیست" }),
    );
    expect(out.ok).toBe(false);
    expect(out.topup?.needsTopup).toBe(true);
    expect(out.error).toBe("موجودی کافی نیست");
  });

  it("خطای غیر-۴۰۲ را با پیامِ error برمی‌گرداند، بدونِ topup", async () => {
    const out = await readPaidActionResponse(fakeResponse(502, { error: "سرویس خراب" }));
    expect(out.ok).toBe(false);
    expect(out.topup).toBeUndefined();
    expect(out.error).toBe("سرویس خراب");
  });

  it("بدنه‌ی نامعتبر (JSON خراب) را با fallback تحمل می‌کند", async () => {
    const bad = {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response;
    const out = await readPaidActionResponse(bad);
    expect(out.ok).toBe(false);
    expect(out.error).toBe("درخواست ناموفق بود.");
  });
});
