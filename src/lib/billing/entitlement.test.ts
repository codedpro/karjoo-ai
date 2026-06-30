/**
 * تست‌های گیتِ استحقاق — با تزریقِ readPlan/readBalance (بدونِ DB).
 */
import { describe, expect, it } from "vitest";

import {
  assertCanUsePaidAi,
  isFreeAction,
  FREE_ACTIONS,
} from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import type { Plan } from "@/db/schema";

function deps(plan: Plan, balance: number) {
  return {
    readPlan: async () => plan,
    readBalance: async () => balance,
  };
}

describe("isFreeAction", () => {
  it("کنش‌های آپلود/اپلای را رایگان می‌داند", () => {
    expect(isFreeAction("resume_upload")).toBe(true);
    expect(isFreeAction("apply")).toBe(true);
    for (const a of FREE_ACTIONS) expect(isFreeAction(a)).toBe(true);
  });
  it("کنش‌های هوش مصنوعی را رایگان نمی‌داند", () => {
    expect(isFreeAction("match")).toBe(false);
    expect(isFreeAction("resume_parse")).toBe(false);
    expect(isFreeAction("cover_letter")).toBe(false);
  });
});

describe("assertCanUsePaidAi", () => {
  it("payg با موجودیِ مثبت ⇒ مجاز", async () => {
    const out = await assertCanUsePaidAi("u1", deps("payg", 5000));
    expect(out).toEqual({ plan: "payg", balanceToman: 5000 });
  });

  it("premium با موجودیِ مثبت (اعتبار/هدیه) ⇒ مجاز", async () => {
    const out = await assertCanUsePaidAi("u1", deps("premium", 100));
    expect(out.plan).toBe("premium");
  });

  it("پلنِ free ⇒ همیشه InsufficientBalanceError (حتی با موجودی)", async () => {
    const err = await assertCanUsePaidAi("u1", deps("free", 9999)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect((err as InsufficientBalanceError).plan).toBe("free");
  });

  it("payg با موجودیِ صفر ⇒ InsufficientBalanceError", async () => {
    const err = await assertCanUsePaidAi("u1", deps("payg", 0)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect((err as InsufficientBalanceError).code).toBe("insufficient_balance");
  });

  it("payg با موجودیِ منفی ⇒ InsufficientBalanceError", async () => {
    const err = await assertCanUsePaidAi("u1", deps("payg", -10)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
  });
});
