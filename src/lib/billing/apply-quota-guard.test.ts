/**
 * تستِ گاردِ سهمیه‌ی اپلای «به‌ازای userId» (WF3 Track B) — بدونِ DB.
 *
 * این لایه مزایای کاربر را می‌خواند و به Foundation#assertApplyQuota واگذار می‌کند.
 * مزایا و شمارشِ امروز را تزریق می‌کنیم تا بدونِ DB/شبکه اجرا شود.
 */
import { describe, expect, it, vi } from "vitest";

import { assertApplyQuotaForUser } from "./apply-quota-guard";
import { ApplyQuotaError } from "./errors";
import { testEntitlements } from "./entitlements";

describe("assertApplyQuotaForUser", () => {
  it("free زیرِ سقف → عبور با وضعیتِ سهمیه", async () => {
    const readEntitlements = vi.fn().mockResolvedValue(testEntitlements());
    const readCountToday = vi.fn().mockResolvedValue(3);

    const status = await assertApplyQuotaForUser("u1", { readEntitlements, readCountToday });
    expect(status).toEqual({ limit: 100, usedToday: 3, remaining: 97 });
    expect(readEntitlements).toHaveBeenCalledWith("u1");
    expect(readCountToday).toHaveBeenCalledWith("u1");
  });

  it("free روی سقف (۱۰۰) → ApplyQuotaError", async () => {
    const readEntitlements = vi.fn().mockResolvedValue(testEntitlements());
    const readCountToday = vi.fn().mockResolvedValue(100);

    await expect(
      assertApplyQuotaForUser("u1", { readEntitlements, readCountToday }),
    ).rejects.toBeInstanceOf(ApplyQuotaError);
  });

  it("اشتراکِ «اپلای نامحدود» → نامحدود، بدونِ شمارش", async () => {
    const readEntitlements = vi.fn().mockResolvedValue(testEntitlements({ unlimitedApplies: true }));
    const readCountToday = vi.fn();

    const status = await assertApplyQuotaForUser("u2", { readEntitlements, readCountToday });
    expect(status).toEqual({ limit: null, usedToday: 0, remaining: null });
    // مسیرِ ارزانِ نامحدود: هیچ کوئریِ شمارشی نباید زده شود.
    expect(readCountToday).not.toHaveBeenCalled();
  });

  it("۱xai در دسترس نیست (مزایای رایگان با unavailable) → همان سقفِ ۱۰۰ (fail-closed)", async () => {
    const readEntitlements = vi
      .fn()
      .mockResolvedValue(testEntitlements({ unavailable: true }));
    const readCountToday = vi.fn().mockResolvedValue(100);

    await expect(
      assertApplyQuotaForUser("u3", { readEntitlements, readCountToday }),
    ).rejects.toBeInstanceOf(ApplyQuotaError);
  });
});
