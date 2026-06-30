/**
 * تستِ گاردِ سهمیه‌ی اپلای «به‌ازای userId» (WF3 Track B) — بدونِ DB.
 *
 * این لایه پلنِ کاربر را می‌خواند و به Foundation#assertApplyQuota واگذار می‌کند.
 * پلن و شمارشِ امروز را تزریق می‌کنیم تا بدونِ DB/شبکه اجرا شود.
 */
import { describe, expect, it, vi } from "vitest";

import { assertApplyQuotaForUser } from "./apply-quota-guard";
import { ApplyQuotaError } from "./errors";

describe("assertApplyQuotaForUser", () => {
  it("free زیرِ سقف → عبور با وضعیتِ سهمیه", async () => {
    const readPlan = vi.fn().mockResolvedValue("free");
    const readCountToday = vi.fn().mockResolvedValue(3);

    const status = await assertApplyQuotaForUser("u1", { readPlan, readCountToday });
    expect(status).toEqual({ limit: 100, usedToday: 3, remaining: 97 });
    expect(readPlan).toHaveBeenCalledWith("u1");
    expect(readCountToday).toHaveBeenCalledWith("u1");
  });

  it("free روی سقف (۱۰۰) → ApplyQuotaError", async () => {
    const readPlan = vi.fn().mockResolvedValue("free");
    const readCountToday = vi.fn().mockResolvedValue(100);

    await expect(
      assertApplyQuotaForUser("u1", { readPlan, readCountToday }),
    ).rejects.toBeInstanceOf(ApplyQuotaError);
  });

  it("پلنِ پولی (pro) → نامحدود، بدونِ شمارش", async () => {
    const readPlan = vi.fn().mockResolvedValue("pro");
    const readCountToday = vi.fn();

    const status = await assertApplyQuotaForUser("u2", { readPlan, readCountToday });
    expect(status).toEqual({ limit: null, usedToday: 0, remaining: null });
    // مسیرِ ارزانِ نامحدود: هیچ کوئریِ شمارشی نباید زده شود.
    expect(readCountToday).not.toHaveBeenCalled();
  });

  it("پلنِ تاریخی payg → مثلِ free رفتار می‌کند (نرمال‌سازی در plans.ts)", async () => {
    const readPlan = vi.fn().mockResolvedValue("payg");
    const readCountToday = vi.fn().mockResolvedValue(100);

    await expect(
      assertApplyQuotaForUser("u3", { readPlan, readCountToday }),
    ).rejects.toBeInstanceOf(ApplyQuotaError);
  });

  it("پلنِ تاریخی premium → مثلِ pro (نامحدود)", async () => {
    const readPlan = vi.fn().mockResolvedValue("premium");
    const readCountToday = vi.fn();

    const status = await assertApplyQuotaForUser("u4", { readPlan, readCountToday });
    expect(status.limit).toBeNull();
    expect(readCountToday).not.toHaveBeenCalled();
  });
});
