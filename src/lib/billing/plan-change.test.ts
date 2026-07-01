/**
 * تست‌های اثرهای تغییرِ پلن (plan-change.ts) — بدونِ DB، با storeِ in-memoryِ Foundation.
 *
 * تضمین‌ها:
 *   • applyPlanChange گرنتِ پلنِ *جدید* را می‌دهد و یادداشت‌های مشتق را برمی‌گرداند.
 *   • ایدمپوتنسی: ارتقا + اجرای کرانِ ماهانه در یک ماه ⇒ تنها یک گرنت (no double-grant).
 *   • planEffectNotes از plans.ts درست مشتق می‌شود (سهمیه/ورکر/تماسِ مستقیم).
 */
import { describe, expect, it } from "vitest";

import { applyPlanChange, planEffectNotes } from "@/lib/billing/plan-change";
import { grantMonthlyCredits, inMemoryGrantStore } from "@/lib/billing/grants";

const JUNE = Date.UTC(2026, 5, 10); // 2026-06

describe("planEffectNotes", () => {
  it("Free: سقفِ ۱۰۰ اپلای، بدونِ ورکر/تماسِ مستقیم", () => {
    expect(planEffectNotes("free")).toEqual({
      planLabelFa: "رایگان",
      applyQuotaPerDay: 100,
      workerIpLimit: 0,
      directContact: false,
    });
  });

  it("MaxPlus: نامحدود، ۵ IPِ ورکر، تماسِ مستقیم", () => {
    expect(planEffectNotes("maxplus")).toEqual({
      planLabelFa: "مکس پلاس",
      applyQuotaPerDay: null,
      workerIpLimit: 5,
      directContact: true,
    });
  });

  it("legacy premium ⇒ مشتقِ pro", () => {
    expect(planEffectNotes("premium").workerIpLimit).toBe(0);
    expect(planEffectNotes("premium").applyQuotaPerDay).toBe(null);
  });
});

describe("applyPlanChange — گرنتِ پلنِ جدید", () => {
  it("ارتقا به Pro ⇒ ۱۰۰۰۰۰ تومان گرنت + یادداشت‌ها", async () => {
    const store = inMemoryGrantStore();
    const res = await applyPlanChange("u1", "max", { store }, JUNE);

    expect(res.grant.granted).toBe(true);
    expect(res.grant.amount).toBe(500_000);
    expect(res.grant.period).toBe("2026-06");
    expect(res.notes.workerIpLimit).toBe(1);
    expect(store.balances.get("u1")).toBe(500_000);
  });
});

describe("applyPlanChange — ایدمپوتنسیِ ارتقا + کرانِ ماهانه", () => {
  it("ارتقا و سپس اجرای کران در همان ماه ⇒ تنها یک گرنت", async () => {
    const store = inMemoryGrantStore();

    // ۱) ارتقا (مسیرِ پرداخت) — اثرِ تغییرِ پلن.
    const upgrade = await applyPlanChange("u1", "pro", { store }, JUNE);
    // ۲) همان ماه، کرانِ ماهانه همان کاربر را دوباره گرنت می‌کند.
    const cron = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);

    expect(upgrade.grant.granted).toBe(true);
    expect(cron.granted).toBe(false); // قبلاً این ماه داده شده.
    // موجودی فقط یک‌بار افزایش یافته.
    expect(store.balances.get("u1")).toBe(100_000);
    expect(store.grantedRefIds.size).toBe(1);
  });

  it("ترتیبِ معکوس (کران سپس ارتقا) هم دوبار گرنت نمی‌دهد", async () => {
    const store = inMemoryGrantStore();
    const cron = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    const upgrade = await applyPlanChange("u1", "pro", { store }, JUNE);

    expect(cron.granted).toBe(true);
    expect(upgrade.grant.granted).toBe(false);
    expect(store.balances.get("u1")).toBe(100_000);
  });
});
