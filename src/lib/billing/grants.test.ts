/**
 * تست‌های گرنتِ اعتبارِ ماهانه (grants.ts) — با storeِ in-memory و پلنِ تزریقی (بدونِ DB).
 *
 * تضمین‌های کلیدی:
 *   • هر پلن مبلغِ درستِ خودش را credit می‌کند.
 *   • ایدمپوتنسی: گرنتِ دومِ همان (کاربر، ماه) چیزی credit نمی‌کند.
 *   • ماهِ متفاوت یک گرنتِ جدا و معتبر است.
 *   • پلنِ Free هیچ گرنتی نمی‌گیرد.
 */
import { describe, expect, it } from "vitest";

import {
  grantMonthlyCredits,
  grantRefId,
  inMemoryGrantStore,
} from "@/lib/billing/grants";

const JUNE = Date.UTC(2026, 5, 10); // 2026-06
const JULY = Date.UTC(2026, 6, 10); // 2026-07

describe("grantRefId", () => {
  it("شکلِ پایدارِ grant:<userId>:<period> دارد", () => {
    expect(grantRefId("u1", "2026-06")).toBe("grant:u1:2026-06");
  });
});

describe("grantMonthlyCredits — مبالغِ پلن", () => {
  it("Pro ⇒ ۱۰۰۰۰۰ تومان credit", async () => {
    const store = inMemoryGrantStore();
    const res = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    expect(res).toEqual({
      granted: true,
      amount: 100_000,
      period: "2026-06",
      refId: "grant:u1:2026-06",
    });
    expect(store.balances.get("u1")).toBe(100_000);
  });

  it("Max ⇒ ۵۰۰۰۰۰، MaxPlus ⇒ ۲۰۰۰۰۰۰", async () => {
    const s1 = inMemoryGrantStore();
    expect((await grantMonthlyCredits("u1", { store: s1, plan: "max" }, JUNE)).amount).toBe(
      500_000,
    );
    const s2 = inMemoryGrantStore();
    expect(
      (await grantMonthlyCredits("u1", { store: s2, plan: "maxplus" }, JUNE)).amount,
    ).toBe(2_000_000);
  });
});

describe("grantMonthlyCredits — ایدمپوتنسی", () => {
  it("گرنتِ دومِ همان ماه چیزی credit نمی‌کند", async () => {
    const store = inMemoryGrantStore();
    const first = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    const second = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);

    expect(first.granted).toBe(true);
    expect(second.granted).toBe(false);
    expect(second.amount).toBe(0);
    // موجودی فقط یک‌بار افزایش یافته.
    expect(store.balances.get("u1")).toBe(100_000);
    expect(store.grantedRefIds.size).toBe(1);
  });

  it("ماهِ متفاوت ⇒ گرنتِ جدا و معتبر", async () => {
    const store = inMemoryGrantStore();
    const june = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    const july = await grantMonthlyCredits("u1", { store, plan: "pro" }, JULY);

    expect(june.granted).toBe(true);
    expect(july.granted).toBe(true);
    expect(july.refId).toBe("grant:u1:2026-07");
    expect(store.balances.get("u1")).toBe(200_000);
  });
});

describe("grantMonthlyCredits — پلنِ بدونِ اعتبار", () => {
  it("Free ⇒ granted=false، بدونِ نوشتن", async () => {
    const store = inMemoryGrantStore();
    const res = await grantMonthlyCredits("u1", { store, plan: "free" }, JUNE);
    expect(res.granted).toBe(false);
    expect(res.amount).toBe(0);
    expect(store.balances.has("u1")).toBe(false);
    expect(store.grantedRefIds.size).toBe(0);
  });

  it("payg (legacy → free) ⇒ بدونِ گرنت", async () => {
    const store = inMemoryGrantStore();
    const res = await grantMonthlyCredits("u1", { store, plan: "payg" }, JUNE);
    expect(res.granted).toBe(false);
  });
});
