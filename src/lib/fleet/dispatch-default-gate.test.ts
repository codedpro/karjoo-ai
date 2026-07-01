/**
 * تستِ متمرکز: گیتِ *پیش‌فرضِ* dispatch باید assertServerAutoApplyAllowed باشد (سطحِ سرور)،
 * نه گیتِ افزونه (Track B / GOAL 3). این تضمین می‌کند ناوگان فقط برای کاربرانی کار می‌گیرد
 * که تاگلِ *سرور* را روشن کرده‌اند و پلنشان ورکر دارد — نه صرفِ تاگلِ افزونه.
 *
 * چون فقط رفتارِ *پیش‌فرض* را می‌سنجیم (assertAllowed تزریق نمی‌شود)، کلِ ماژولِ
 * auto-apply را mock می‌کنیم تا فراخوانیِ گیت را رهگیری کنیم؛ بقیه‌ی deps تزریق می‌شوند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apply/auto-apply", () => ({
  assertServerAutoApplyAllowed: vi.fn(),
  assertAutoApplyAllowed: vi.fn(),
  recordAutoApplyAudit: vi.fn(),
}));

import {
  assertServerAutoApplyAllowed,
  assertAutoApplyAllowed,
} from "@/lib/apply/auto-apply";
import { claimFleetJobs } from "@/lib/fleet/dispatch";

const serverGateMock = vi.mocked(assertServerAutoApplyAllowed);
const extensionGateMock = vi.mocked(assertAutoApplyAllowed);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimFleetJobs — گیتِ پیش‌فرض = سطحِ سرور", () => {
  it("assertServerAutoApplyAllowed را صدا می‌زند، نه گیتِ افزونه", async () => {
    serverGateMock.mockResolvedValue({
      minScore: 0.7,
      quota: { limit: null, usedToday: 0, remaining: null },
    });

    await claimFleetJobs("node-1", 3, {
      // فقط deps لازم برای رسیدن به گیت تزریق می‌شود؛ assertAllowed تزریق *نمی‌شود*.
      readAssignedUserIds: async () => ["u1"],
      readPlan: async () => "max",
      claimItems: async () => [], // پس از گیت، آیتمی برنمی‌گردد (کافی برای این تست).
      loadSession: async () => "S",
    });

    // گیتِ سرور با (userId, plan) صدا خورد.
    expect(serverGateMock).toHaveBeenCalledTimes(1);
    expect(serverGateMock.mock.calls[0][0]).toBe("u1");
    expect(serverGateMock.mock.calls[0][1]).toBe("max");
    // گیتِ افزونه هرگز در مسیرِ ناوگان صدا نمی‌خورد.
    expect(extensionGateMock).not.toHaveBeenCalled();
  });
});
