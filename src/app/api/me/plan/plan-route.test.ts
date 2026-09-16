/**
 * تست‌های `/api/me/plan` — GET (اشتراکِ 1xai + ردهٔ قدیمی برای افزونه) و POST (۴۱۰).
 *
 * نشست (getCurrentUserOrBearer) و لایه‌ی وضعیت (getUserPlanStatus) mock می‌شوند —
 * بدونِ DB/شبکه. تمرکز:
 *   • بدونِ نشست → ۴۰۱ و هیچ خواندنی.
 *   • ردهٔ قدیمی (plan) از مزایا: ورکر ≥۵ → maxplus، >۰ → max، نامحدود → pro، وگرنه free.
 *   • شکلِ subscription (+ manageUrl) و topupUrl.
 *   • POST دیگر پلن نمی‌فروشد → ۴۱۰ با manageUrl.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUserOrBearer: vi.fn() }));
vi.mock("@/components/dashboard/plan-data", () => ({ getUserPlanStatus: vi.fn() }));

import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import {
  ONEXAI_PLAN_URL,
  ONEXAI_TOPUP_URL,
  testEntitlements,
  type Entitlements,
} from "@/lib/billing/entitlements";
import { GET, POST } from "@/app/api/me/plan/route";

const getUserMock = vi.mocked(getCurrentUserOrBearer);
const statusMock = vi.mocked(getUserPlanStatus);

const USER = { id: "user-1", isActive: true } as never;

function req() {
  return new Request("https://k.app/api/me/plan", { method: "GET" });
}

function withEntitlements(entitlements: Entitlements, balanceToman = 0) {
  statusMock.mockResolvedValue({
    entitlements,
    balanceToman,
    apply: entitlements.unlimitedApplies
      ? { limit: null, usedToday: 0, remaining: null }
      : { limit: 100, usedToday: 4, remaining: 96 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue(USER);
});

describe("GET /api/me/plan", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ خواندنی", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("ردهٔ قدیمی از مزایا ساخته می‌شود", async () => {
    const cases: Array<[Entitlements, string]> = [
      [testEntitlements(), "free"],
      [testEntitlements({ status: "active", planKey: "plus" }), "free"],
      [testEntitlements({ unlimitedApplies: true }), "pro"],
      [testEntitlements({ unlimitedApplies: true, workerIpLimit: 1, status: "active" }), "max"],
      [testEntitlements({ workerIpLimit: 4 }), "max"],
      [testEntitlements({ unlimitedApplies: true, workerIpLimit: 5, status: "active" }), "maxplus"],
      [testEntitlements({ workerIpLimit: 12 }), "maxplus"],
    ];
    for (const [e, tier] of cases) {
      withEntitlements(e);
      const body = await (await GET(req())).json();
      expect(body.plan, `${JSON.stringify(e)} → ${tier}`).toBe(tier);
    }
  });

  it("شکلِ subscription + موجودی + سهمیه (مقید به کاربرِ نشست)", async () => {
    withEntitlements(
      testEntitlements({
        planKey: "pro",
        planNameFa: "حرفه‌ای",
        status: "active",
        periodEnd: new Date("2026-10-01T00:00:00Z"),
        unlimitedApplies: true,
        workerIpLimit: 1,
      }),
      42_000,
    );

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(statusMock).toHaveBeenCalledWith("user-1");
    expect(body).toEqual({
      plan: "max",
      subscription: {
        planKey: "pro",
        planNameFa: "حرفه‌ای",
        status: "active",
        periodEnd: "2026-10-01T00:00:00.000Z",
        unlimitedApplies: true,
        workerIpLimit: 1,
        unavailable: false,
        manageUrl: ONEXAI_PLAN_URL,
      },
      balanceToman: 42_000,
      topupUrl: ONEXAI_TOPUP_URL,
      apply: { limit: null, usedToday: 0, remaining: null },
    });
  });

  it("1xai در دسترس نبود → رایگان با unavailable=true و periodEnd=null", async () => {
    withEntitlements(testEntitlements({ unavailable: true }));
    const body = await (await GET(req())).json();
    expect(body.plan).toBe("free");
    expect(body.subscription.unavailable).toBe(true);
    expect(body.subscription.periodEnd).toBeNull();
    expect(body.apply).toEqual({ limit: 100, usedToday: 4, remaining: 96 });
  });
});

describe("POST /api/me/plan", () => {
  it("بازنشسته → ۴۱۰ با manageUrlِ 1xai (بدونِ خواندنِ نشست/وضعیت)", async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("1xai");
    expect(body.details).toEqual({ manageUrl: ONEXAI_PLAN_URL });
    expect(statusMock).not.toHaveBeenCalled();
  });
});
