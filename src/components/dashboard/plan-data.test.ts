/**
 * تست‌های لایه‌ی وضعیتِ اشتراکِ کاربر (`plan-data.ts`).
 *
 * اشتراکِ 1xai (readEntitlements)، کیف‌پولِ واحد (getUnifiedBalance) و شمارشِ اپلای
 * (countAppliesToday) mock می‌شوند — هیچ DB/شبکه‌ی زنده. تمرکز:
 *   • مزایا همان‌طور که از 1xai آمده برمی‌گردند.
 *   • موجودی = availableTomanِ کیف‌پولِ واحد؛ svc خطادار → ۰ (نمایشی، نه fail-closed).
 *   • اشتراکِ «اپلای نامحدود»: سهمیه null و *بدونِ* کوئریِ شمارشِ اپلای (مسیرِ ارزان).
 *   • بدونِ اشتراک: سهمیه ۱۰۰ و باقی‌مانده درست محاسبه می‌شود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/unified", () => ({ getUnifiedBalance: vi.fn() }));
vi.mock("@/lib/billing/apply-quota", () => ({ countAppliesToday: vi.fn() }));
vi.mock("@/lib/billing/subscription", () => ({ readEntitlements: vi.fn() }));

import { getUnifiedBalance } from "@/lib/billing/unified";
import { countAppliesToday } from "@/lib/billing/apply-quota";
import { readEntitlements } from "@/lib/billing/subscription";
import { testEntitlements } from "@/lib/billing/entitlements";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";

const getUnifiedBalanceMock = vi.mocked(getUnifiedBalance);
const countAppliesMock = vi.mocked(countAppliesToday);
const readEntitlementsMock = vi.mocked(readEntitlements);

/** موجودیِ واحدِ جعلی — فقط availableToman برای نمایش مهم است. */
function poolBalance(availableToman: number) {
  return {
    balanceToman: availableToman,
    heldToman: 0,
    availableToman,
    isActive: true,
    unlimited: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserPlanStatus", () => {
  it("بدونِ اشتراک: سهمیه ۱۰۰، باقی‌مانده درست، موجودی ۰", async () => {
    const free = testEntitlements();
    readEntitlementsMock.mockResolvedValue(free);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    countAppliesMock.mockResolvedValue(7);

    const status = await getUserPlanStatus("user-1");
    expect(readEntitlementsMock).toHaveBeenCalledWith("user-1");
    expect(status.entitlements).toEqual(free);
    expect(status.balanceToman).toBe(0);
    expect(status.apply).toEqual({ limit: 100, usedToday: 7, remaining: 93 });
    expect(countAppliesMock).toHaveBeenCalledWith("user-1");
  });

  it("مصرفِ بیش از سقف → باقی‌مانده ۰ (هرگز منفی نیست)", async () => {
    readEntitlementsMock.mockResolvedValue(testEntitlements());
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    countAppliesMock.mockResolvedValue(130);

    const status = await getUserPlanStatus("user-1");
    expect(status.apply.remaining).toBe(0);
  });

  it("اپلای نامحدود: سهمیه null و هیچ کوئریِ شمارشِ اپلای زده نمی‌شود", async () => {
    const pro = testEntitlements({ planKey: "pro", status: "active", unlimitedApplies: true });
    readEntitlementsMock.mockResolvedValue(pro);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(120_000));

    const status = await getUserPlanStatus("user-1");
    expect(status.entitlements.planKey).toBe("pro");
    expect(status.balanceToman).toBe(120_000);
    expect(status.apply).toEqual({ limit: null, usedToday: 0, remaining: null });
    expect(countAppliesMock).not.toHaveBeenCalled();
  });

  it("کیف‌پولِ واحدِ خطادار → ۰ (نمایشی؛ هرگز throw نمی‌کند)", async () => {
    readEntitlementsMock.mockResolvedValue(testEntitlements());
    getUnifiedBalanceMock.mockRejectedValue(new Error("svc down"));
    countAppliesMock.mockResolvedValue(0);

    const status = await getUserPlanStatus("user-1");
    expect(status.balanceToman).toBe(0);
  });

  it("1xai در دسترس نیست → مزایای رایگان با unavailable (سهمیه ۱۰۰)", async () => {
    readEntitlementsMock.mockResolvedValue(testEntitlements({ unavailable: true }));
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    countAppliesMock.mockResolvedValue(0);

    const status = await getUserPlanStatus("user-1");
    expect(status.entitlements.unavailable).toBe(true);
    expect(status.apply.limit).toBe(100);
  });
});
