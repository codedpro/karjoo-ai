/**
 * تست‌های کیف‌پول — با storeِ in-memory (بدونِ DB). atomicity واقعی در
 * wallet.integration.test.ts روی Postgres سنجیده می‌شود؛ اینجا منطقِ موجودی/دفتر.
 */
import { describe, expect, it } from "vitest";

import {
  credit,
  debit,
  getBalance,
  getOrCreateWallet,
  inMemoryWalletStore,
} from "@/lib/billing/wallet";

describe("getOrCreateWallet / getBalance", () => {
  it("کیف‌پولِ تازه با موجودیِ صفر می‌سازد", async () => {
    const store = inMemoryWalletStore();
    const w = await getOrCreateWallet("u1", store);
    expect(w.userId).toBe("u1");
    expect(w.balanceToman).toBe(0);
    expect(await getBalance("u1", store)).toBe(0);
  });

  it("موجودیِ موجود را برمی‌گرداند", async () => {
    const store = inMemoryWalletStore({ u1: 5000 });
    expect(await getBalance("u1", store)).toBe(5000);
  });
});

describe("credit", () => {
  it("موجودی را افزایش و یک ردیفِ دفتر با balanceAfter می‌نویسد", async () => {
    const store = inMemoryWalletStore({ u1: 1000 });
    const res = await credit("u1", "topup", 4000, { refType: "topup", refId: "p1" }, store);
    expect(res.balanceToman).toBe(5000);
    expect(store.ledger).toHaveLength(1);
    expect(store.ledger[0]).toMatchObject({
      userId: "u1",
      kind: "topup",
      amount: 4000,
      balanceAfter: 5000,
    });
  });

  it("مبلغِ غیرمثبت را رد می‌کند", async () => {
    const store = inMemoryWalletStore();
    await expect(credit("u1", "topup", 0, {}, store)).rejects.toThrow();
    await expect(credit("u1", "grant", -10, {}, store)).rejects.toThrow();
  });
});

describe("debit", () => {
  it("موجودی را کاهش و یک ردیفِ دفترِ منفی می‌نویسد", async () => {
    const store = inMemoryWalletStore({ u1: 5000 });
    const res = await debit("u1", "charge", 1200, { refType: "usage_record", refId: "x" }, store);
    expect(res.balanceToman).toBe(3800);
    expect(store.ledger[0]).toMatchObject({ kind: "charge", amount: -1200, balanceAfter: 3800 });
  });

  it("چند debitِ متوالی هیچ‌کدام گم نمی‌شوند (مجموع درست)", async () => {
    const store = inMemoryWalletStore({ u1: 10_000 });
    await debit("u1", "charge", 1000, {}, store);
    await debit("u1", "charge", 2500, {}, store);
    await debit("u1", "charge", 500, {}, store);
    expect(store.balances.get("u1")).toBe(6000);
    expect(store.ledger).toHaveLength(3);
    // balanceAfter هر ردیف باید نزولیِ درست باشد.
    expect(store.ledger.map((l) => l.balanceAfter)).toEqual([9000, 6500, 6000]);
  });

  it("مبلغِ منفی را رد می‌کند", async () => {
    const store = inMemoryWalletStore();
    await expect(debit("u1", "charge", -5, {}, store)).rejects.toThrow();
  });
});
