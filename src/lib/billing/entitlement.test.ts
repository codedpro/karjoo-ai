/**
 * تست‌های گیتِ استحقاق — با تزریقِ readPlan/readBalance (بدونِ DB و بدونِ svcِ 1xai).
 *
 * موجودی حالا از کیف‌پولِ واحدِ 1xai می‌آید (availableToman)؛ تزریقِ readBalance همان
 * درز است. دو تضمینِ تازه قفل می‌شوند: پیامِ «شارژ در 1xai» و propagate شدنِ
 * OnexaiSvcUnavailableError (fail-closed).
 */
import { describe, expect, it } from "vitest";

import {
  assertCanUsePaidAi,
  isFreeAction,
  FREE_ACTIONS,
} from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";
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

  it("پلنِ pro با موجودیِ مثبت ⇒ مجاز", async () => {
    const out = await assertCanUsePaidAi("u1", deps("pro", 50_000));
    expect(out).toEqual({ plan: "pro", balanceToman: 50_000 });
  });

  it("پلنِ free با موجودیِ مثبت ⇒ مجاز (گیت روی موجودی است، نه پلن)", async () => {
    const out = await assertCanUsePaidAi("u1", deps("free", 9999));
    expect(out).toEqual({ plan: "free", balanceToman: 9999 });
  });

  it("پلنِ free با موجودیِ صفر ⇒ InsufficientBalanceError", async () => {
    const err = await assertCanUsePaidAi("u1", deps("free", 0)).catch((e) => e);
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

  it("پیامِ موجودیِ ناکافی، شارژ در 1xai را نشان می‌دهد (کیف‌پولِ واحد)", async () => {
    const err = await assertCanUsePaidAi("u1", deps("payg", 0)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect((err as InsufficientBalanceError).message).toContain("1xai");
  });

  it("svcِ 1xai در دسترس نیست ⇒ OnexaiSvcUnavailableError propagate می‌شود (fail-closed)", async () => {
    const err = await assertCanUsePaidAi("u1", {
      readPlan: async () => "payg" as Plan,
      readBalance: async () => {
        throw new OnexaiSvcUnavailableError();
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(OnexaiSvcUnavailableError);
  });
});
