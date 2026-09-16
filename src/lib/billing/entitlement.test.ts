/**
 * تست‌های گیتِ استحقاق — با تزریقِ readEntitlements/readBalance (بدونِ DB و بدونِ svcِ 1xai).
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
import { testEntitlements, type Entitlements } from "@/lib/billing/entitlements";

const FREE = testEntitlements();
const ACTIVE = testEntitlements({ planKey: "pro", planNameFa: "حرفه‌ای", status: "active" });

function deps(e: Entitlements, balance: number) {
  return {
    readEntitlements: async () => e,
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
  it("بدونِ اشتراک با موجودیِ مثبت ⇒ مجاز (گیت روی موجودی است)", async () => {
    const out = await assertCanUsePaidAi("u1", deps(FREE, 5000));
    expect(out).toEqual({ plan: "رایگان", balanceToman: 5000 });
  });

  it("اشتراکِ فعال با موجودیِ مثبت ⇒ مجاز و نامِ پلن برمی‌گردد", async () => {
    const out = await assertCanUsePaidAi("u1", deps(ACTIVE, 50_000));
    expect(out).toEqual({ plan: "حرفه‌ای", balanceToman: 50_000 });
  });

  it("اشتراکِ فعال با موجودیِ صفر ⇒ مجاز (اعتبارِ اشتراک در 1xai مصرف می‌شود)", async () => {
    const out = await assertCanUsePaidAi("u1", deps(ACTIVE, 0));
    expect(out).toEqual({ plan: "حرفه‌ای", balanceToman: 0 });
  });

  it("بدونِ اشتراک با موجودیِ صفر ⇒ InsufficientBalanceError با نامِ پلن", async () => {
    const err = await assertCanUsePaidAi("u1", deps(FREE, 0)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect((err as InsufficientBalanceError).code).toBe("insufficient_balance");
    expect((err as InsufficientBalanceError).plan).toBe("رایگان");
  });

  it("بدونِ اشتراک با موجودیِ منفی ⇒ InsufficientBalanceError", async () => {
    const err = await assertCanUsePaidAi("u1", deps(FREE, -10)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
  });

  it("مزایای رایگانِ جایگزین (1xai در دسترس نبود) + موجودیِ صفر ⇒ رد", async () => {
    const err = await assertCanUsePaidAi(
      "u1",
      deps(testEntitlements({ unavailable: true }), 0),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
  });

  it("پیامِ موجودیِ ناکافی، شارژ در 1xai را نشان می‌دهد (کیف‌پولِ واحد)", async () => {
    const err = await assertCanUsePaidAi("u1", deps(FREE, 0)).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientBalanceError);
    expect((err as InsufficientBalanceError).message).toContain("1xai");
  });

  it("svcِ 1xai در دسترس نیست ⇒ OnexaiSvcUnavailableError propagate می‌شود (fail-closed)", async () => {
    const err = await assertCanUsePaidAi("u1", {
      readEntitlements: async () => ACTIVE,
      readBalance: async () => {
        throw new OnexaiSvcUnavailableError();
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(OnexaiSvcUnavailableError);
  });
});
