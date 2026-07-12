/**
 * تست‌های ماشینِ حالتِ خریدِ پلن (plan-purchase.ts) — پول‌بحرانی.
 *
 * تضمین‌های کلیدی (شاملِ یافته‌های راستی‌آزماییِ خصمانه):
 *   • reference هیچ مؤلفه‌ی زمانی ندارد (plan:<rowId>) → retry پس از رفتنِ ماه هم به
 *     همان reference می‌رسد.
 *   • کرش پس از completed و پیش از ثبتِ پلن → retry از مسیرِ «فعال‌سازیِ مجددِ» همان
 *     ماه بدونِ کسرِ تازه ترمیم می‌کند.
 *   • ردیفِ بازِ *جوان* (راننده‌ی زنده) هرگز settle نمی‌شود → PurchaseConflictError؛
 *     فقط ردیفِ کهنه‌تر از پنجره‌ی امن خنثیِ مالی می‌شود (debitِ قطعی‌ساز + refundِ کامل).
 *   • گذارها مقایسه‌و‌ست‌اند: ردیفِ abandoned/refundشده نمی‌تواند «زنده» شود و پلن بدهد.
 *   • فعال‌سازیِ مجددِ همان پلن در همان ماه رایگان است (بدونِ کسرِ دوم).
 * بدونِ DB/شبکه: store حافظه‌ای + ساعت/debit/credit/balanceِ تزریقی.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  inMemoryPurchaseStore,
  purchasePlan,
  settleOpenPurchase,
  PurchaseConflictError,
  SETTLE_GRACE_MS,
  type PurchaseStore,
} from "@/lib/billing/plan-purchase";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";

/** ساعتِ کنترل‌شدنی — پنجره‌ی امن/ماه را قطعی می‌کند. */
let t = Date.UTC(2026, 6, 10); // 2026-07-10
const nowFn = () => t;
const pastGrace = () => {
  t += SETTLE_GRACE_MS + 1_000;
};

/** debitِ جعلیِ idempotent — reference‌های دیده‌شده را نگه می‌دارد (مثلِ 1xai). */
function makeDebit(opts: { balance?: number } = {}) {
  const seen = new Set<string>();
  const fn = vi.fn(async (_u: string, _a: number, ref: string) => {
    const already = seen.has(ref);
    seen.add(ref);
    return { balanceToman: opts.balance ?? 500_000, already };
  });
  return { fn, seen };
}

const creditFn = vi.fn(async () => ({ balanceToman: 500_000, already: false }));
const balanceFn = vi.fn(async () => ({
  balanceToman: 500_000,
  heldToman: 0,
  availableToman: 500_000,
  isActive: true,
  unlimited: false,
}));

/** depsِ مشترک — هر تست store/debit خودش را می‌دهد. */
function deps(store: PurchaseStore, debitFn: unknown) {
  return {
    store,
    debitUnifiedFn: debitFn as never,
    creditUnifiedFn: creditFn as never,
    getUnifiedBalanceFn: balanceFn as never,
    now: nowFn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  t = Date.UTC(2026, 6, 10);
});

describe("purchasePlan — مسیرِ شاد و شکلِ reference", () => {
  it("ردیف می‌سازد، با plan:<rowId> کسر می‌کند (بدونِ هیچ زمانی)، completed و پلن ست می‌شود", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    const res = await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn));

    expect(res.balanceToman).toBe(500_000);
    const row = store.rows[0];
    expect(row.status).toBe("completed");
    // شکلِ حیاتی: فقط از rowId — نه تاریخ، نه ماه، نه Date.now.
    expect(row.reference).toBe(`plan:${row.id}`);
    expect(row.reference).not.toMatch(/\d{4}-\d{2}/);
    expect(debit.fn).toHaveBeenCalledWith("u1", 299_000, row.reference, expect.anything());
    expect(store.userPlans.get("u1")).toBe("pro");
    expect(creditFn).not.toHaveBeenCalled();
  });
});

describe("purchasePlan — ترمیمِ کرش", () => {
  it("کرش در completeAndGrant (تراکنشِ اتمیک) → ردیف debited می‌ماند؛ retry حتی «ماه‌ها بعد» با همان reference کامل می‌کند", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    // کرشِ شبیه‌سازی‌شده: تراکنشِ ادعا+اعطا شکست می‌خورد — اتمیک: *هیچ‌کدام* اعمال نشده.
    let allowComplete = false;
    const crashingStore: PurchaseStore = {
      ...store,
      completeAndGrant: vi.fn(async (id, userId, plan) => {
        if (!allowComplete) throw new Error("db down mid-transaction");
        return store.completeAndGrant(id, userId, plan);
      }),
    };
    await expect(
      purchasePlan("u1", "pro", 299_000, deps(crashingStore, debit.fn)),
    ).rejects.toThrow("db down mid-transaction");

    // اتمیک بودن یعنی هرگز «completed بدونِ پلن» وجود ندارد — ردیف debited مانده.
    expect(store.rows[0].status).toBe("debited");
    expect(store.userPlans.has("u1")).toBe(false);
    const ref = store.rows[0].reference;

    // retry «ماه‌ها بعد» (زمان در reference نیست؛ برخلافِ طرحِ month-keyedِ قدیم):
    allowComplete = true;
    t = Date.UTC(2026, 9, 5); // دو ماه بعد
    const res = await purchasePlan("u1", "pro", 299_000, deps(crashingStore, debit.fn));
    expect(store.rows).toHaveLength(1); // ردیف/کسرِ تازه‌ای نیست.
    expect(store.rows[0].status).toBe("completed");
    expect(store.userPlans.get("u1")).toBe("pro");
    expect(debit.fn).toHaveBeenCalledTimes(2);
    expect(debit.fn.mock.calls[0][2]).toBe(ref);
    expect(debit.fn.mock.calls[1][2]).toBe(ref); // idempotent — دومی already=true.
    expect(res.purchaseId).toBe(store.rows[0].id);
  });

  it("svc قطع در debit → ردیف باز می‌ماند و retry از همان reference ادامه می‌دهد", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const failingDebit = vi.fn(async () => {
      throw new OnexaiSvcUnavailableError();
    });

    await expect(
      purchasePlan("u1", "pro", 299_000, deps(store, failingDebit)),
    ).rejects.toBeInstanceOf(OnexaiSvcUnavailableError);
    expect(store.rows[0].status).toBe("pending");
    const ref = store.rows[0].reference;

    const debit = makeDebit();
    await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn));
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("completed");
    expect(debit.fn).toHaveBeenCalledWith("u1", 299_000, ref, expect.anything());
  });
});

describe("purchasePlan — موجودیِ ناکافی", () => {
  it("۴۰۲ از debit → ردیف abandoned و خطا بالا می‌رود (بدونِ ثبتِ پلن)", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const failingDebit = vi.fn(async () => {
      throw new InsufficientBalanceError({ balanceToman: 1_000, plan: "free" });
    });

    await expect(
      purchasePlan("u1", "pro", 299_000, deps(store, failingDebit)),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(store.rows[0].status).toBe("abandoned");
    expect(store.userPlans.has("u1")).toBe(false);
  });
});

describe("purchasePlan — پنجره‌ی امن و خریدِ بازِ ناهم‌خوان", () => {
  it("ردیفِ بازِ *جوان* با پلنِ دیگر → PurchaseConflictError (نه refundِ ردیفِ زنده)", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();
    await store.create("u1", "pro", 299_000); // راننده‌ی زنده (همین لحظه)

    await expect(
      purchasePlan("u1", "max", 999_000, deps(store, debit.fn)),
    ).rejects.toBeInstanceOf(PurchaseConflictError);
    expect(creditFn).not.toHaveBeenCalled();
    expect(store.rows[0].status).toBe("pending"); // دست‌نخورده.
  });

  it("ردیفِ بازِ *کهنه‌ی* debited با پلنِ دیگر → قطعی‌سازی + refundِ کامل + خریدِ تازه (خالصِ صفر)", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    const old = await store.create("u1", "pro", 299_000);
    await store.transition(old.id, "debited", ["pending"]);
    debit.seen.add(old.reference); // پولش سمتِ 1xai نشسته.
    pastGrace(); // کرشِ واقعی — نه راننده‌ی زنده.

    const res = await purchasePlan("u1", "max", 999_000, deps(store, debit.fn));

    expect(creditFn).toHaveBeenCalledTimes(1);
    expect(creditFn).toHaveBeenCalledWith(
      "u1",
      299_000,
      "refund",
      `plan-refund:${old.id}`,
      expect.anything(),
    );
    expect(store.rows.find((r) => r.id === old.id)?.status).toBe("abandoned");
    const fresh = store.rows.find((r) => r.id !== old.id)!;
    expect(fresh.status).toBe("completed");
    expect(store.userPlans.get("u1")).toBe("max");
    expect(res.purchaseId).toBe(fresh.id);
  });
});

describe("purchasePlan — ضدِ رستاخیزِ ردیفِ refundشده (مقایسه‌و‌ست)", () => {
  it("اگر حینِ پرواز ردیف abandoned شده باشد، ادعای completed شکست می‌خورد و پلن اعطا نمی‌شود", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    // شبیه‌سازیِ R2: درست پس از debitِ R1، ردیف abandoned/refund می‌شود.
    const sabotage: PurchaseStore = {
      ...store,
      transition: vi.fn(async (id, to, expected) => {
        if (to === "debited") {
          // R2 وسطِ کارِ R1 ردیف را می‌بندد (settleِ فرضی).
          await store.transition(id, "abandoned", ["pending", "debited"]);
        }
        return store.transition(id, to, expected);
      }),
    };

    await expect(
      purchasePlan("u1", "pro", 299_000, deps(sabotage, debit.fn)),
    ).rejects.toBeInstanceOf(PurchaseConflictError);
    // پلن هرگز اعطا نشد — ردیفِ refundشده زنده نشد.
    expect(store.userPlans.has("u1")).toBe(false);
    expect(store.rows[0].status).toBe("abandoned");
  });
});

describe("purchasePlan — فعال‌سازیِ مجددِ همان ماه (بدونِ کسرِ دوم)", () => {
  it("خریدِ completedِ همین ماه + خریدِ دوباره‌ی همان پلن → reactivated، هیچ debitی", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn)); // خریدِ اول
    store.userPlans.set("u1", "free"); // پایین‌آوردنِ کاربر (مسیرِ route)

    const res = await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn)); // برگشت
    expect(res.reactivated).toBe(true);
    expect(debit.fn).toHaveBeenCalledTimes(1); // فقط خریدِ اول.
    expect(store.userPlans.get("u1")).toBe("pro");
    expect(store.rows).toHaveLength(1);
  });

  it("ماهِ بعد → خریدِ تازه با کسرِ تازه (فعال‌سازیِ مجدد فقط درونِ همان ماه)", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn));
    store.userPlans.set("u1", "free");
    t = Date.UTC(2026, 7, 2); // ماهِ بعد (2026-08)

    const res = await purchasePlan("u1", "pro", 299_000, deps(store, debit.fn));
    expect(res.reactivated).toBeUndefined();
    expect(debit.fn).toHaveBeenCalledTimes(2);
    expect(store.rows).toHaveLength(2);
  });
});

describe("settleOpenPurchase — مسیرِ پایین‌آوردن", () => {
  it("ردیفِ کهنه‌ی debited (کرشِ ارتقا) → refundِ کامل + abandoned؛ بدونِ ردیفِ باز بی‌اثر", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    // بدونِ ردیفِ باز: بی‌اثر.
    await settleOpenPurchase("u1", deps(store, debit.fn));
    expect(creditFn).not.toHaveBeenCalled();

    // کرشِ ارتقا: debited مانده؛ کاربر پایین می‌آورد → پولش باید برگردد.
    const old = await store.create("u1", "pro", 299_000);
    await store.transition(old.id, "debited", ["pending"]);
    debit.seen.add(old.reference);
    pastGrace();

    await settleOpenPurchase("u1", deps(store, debit.fn));
    expect(creditFn).toHaveBeenCalledWith(
      "u1",
      299_000,
      "refund",
      `plan-refund:${old.id}`,
      expect.anything(),
    );
    expect(store.rows[0].status).toBe("abandoned");
  });

  it("ردیفِ بازِ جوان → PurchaseConflictError (پایین‌آوردن هم صبر می‌کند)", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();
    await store.create("u1", "pro", 299_000);

    await expect(settleOpenPurchase("u1", deps(store, debit.fn))).rejects.toBeInstanceOf(
      PurchaseConflictError,
    );
  });
});

describe("purchasePlan — مسابقه‌ی دوکلیک (همان پلن)", () => {
  it("createِ دوم به یکتاییِ خریدِ باز می‌خورد → ردیفِ برنده ادامه می‌یابد؛ یک کسر", async () => {
    const store = inMemoryPurchaseStore(nowFn);
    const debit = makeDebit();

    const racingStore: PurchaseStore = {
      ...store,
      create: vi.fn(async () => {
        await store.create("u1", "pro", 299_000);
        throw new Error("unique violation: plan_purchases_open_user_uq");
      }),
    };

    const res = await purchasePlan("u1", "pro", 299_000, deps(racingStore, debit.fn));
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("completed");
    expect(debit.fn).toHaveBeenCalledTimes(1);
    expect(res.purchaseId).toBe(store.rows[0].id);
  });
});
