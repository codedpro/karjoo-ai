/**
 * تست‌های گرنتِ اعتبارِ ماهانه (grants.ts) — *ماشینِ خفته* پس از اتحاد با 1xAi.
 *
 * با کیف‌پولِ واحد، پلن = «استحقاق + قیمت» و monthlyCreditToman برای *همه‌ی* پلن‌ها ۰
 * است؛ پس تضمینِ کلیدیِ این suite دیگر «مبلغِ درستِ هر پلن» نیست بلکه *بی‌اثریِ کامل*
 * است: هیچ پلنی، هیچ ماهی، هیچ creditی — تا اگر روزی کرانِ فراموش‌شده‌ای این ماشین را
 * صدا زد، هیچ پولی جابه‌جا نشود. (خودِ ماشین برای تاریخچه نگه داشته شده؛ grantRefId
 * هنوز مصرف‌کننده‌ی زنده دارد: plan-data برای خواندنِ تاریخچه‌ی گرنت‌های قدیمی.)
 */
import { describe, expect, it } from "vitest";

import {
  grantMonthlyCredits,
  grantRefId,
  inMemoryGrantStore,
} from "@/lib/billing/grants";

const JUNE = Date.UTC(2026, 5, 10); // 2026-06

describe("grantRefId", () => {
  it("شکلِ پایدارِ grant:<userId>:<period> دارد", () => {
    expect(grantRefId("u1", "2026-06")).toBe("grant:u1:2026-06");
  });
});

describe("grantMonthlyCredits — بی‌اثر برای همه‌ی پلن‌ها (کیف‌پولِ واحدِ 1xai)", () => {
  it.each(["free", "pro", "max", "maxplus", "payg"] as const)(
    "%s ⇒ granted=false، amount=0، بدونِ هیچ نوشتنی",
    async (plan) => {
      const store = inMemoryGrantStore();
      const res = await grantMonthlyCredits("u1", { store, plan }, JUNE);
      expect(res.granted).toBe(false);
      expect(res.amount).toBe(0);
      // هیچ موجودی/refIdی نوشته نمی‌شود — ماشین کاملاً خفته است.
      expect(store.balances.has("u1")).toBe(false);
      expect(store.grantedRefIds.size).toBe(0);
    },
  );

  it("دو اجرای پیاپی هم هیچ‌چیز نمی‌نویسد (بی‌اثریِ پایدار، نه فقط ایدمپوتنسی)", async () => {
    const store = inMemoryGrantStore();
    await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    const second = await grantMonthlyCredits("u1", { store, plan: "pro" }, JUNE);
    expect(second.granted).toBe(false);
    expect(store.balances.size).toBe(0);
  });
});
