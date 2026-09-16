/**
 * تست‌های لایه‌ی وضعیتِ سرورِ اپلایِ کاربر (`fleet-status-data.ts`) — Track C.
 *
 * DB، مزایای اشتراکِ 1xai (readEntitlements) و فهرستِ تخصیص (listAssignments) mock می‌شوند —
 * هیچ DB/شبکه‌ی زنده. تمرکز:
 *   • Free/Pro (بدونِ ورکر): مسیرِ ارزان — تخصیص/نشست اصلاً کوئری نمی‌شود.
 *   • Max: تعدادِ نودهای تخصیص‌یافته و تازگیِ نشست درست جمع می‌شوند.
 *   • قاعده‌ی ۴: داده مقید به همان userId است (مزایا/تخصیص با همان id خوانده می‌شوند).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/lib/billing/subscription", () => ({ readEntitlements: vi.fn() }));
vi.mock("@/lib/fleet/assign", () => ({ listAssignments: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder: Record<string, unknown> = {};
      const ret = () => builder;
      builder.from = ret;
      builder.innerJoin = ret;
      builder.where = ret;
      builder.orderBy = ret;
      builder.limit = () => Promise.resolve(rows);
      builder.then = (resolve: (r: unknown[]) => unknown) =>
        Promise.resolve(resolve(rows));
      return builder;
    }),
  },
}));

import { readEntitlements } from "@/lib/billing/subscription";
import { testEntitlements } from "@/lib/billing/entitlements";
import { listAssignments } from "@/lib/fleet/assign";
import { getFleetStatusData } from "@/components/dashboard/fleet-status-data";

const planMock = vi.mocked(readEntitlements);
const assignMock = vi.mocked(listAssignments);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

/** نگاشتِ پلن‌های قدیمی به مزایای 1xai. */
const PLANS = {
  free: testEntitlements(),
  pro: testEntitlements({ unlimitedApplies: true }),
  max: testEntitlements({ unlimitedApplies: true, workerIpLimit: 1, status: "active" }),
};
function planStatus(plan: keyof typeof PLANS) {
  return PLANS[plan];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

describe("getFleetStatusData", () => {
  it("Free: بدونِ ورکر — مسیرِ ارزان، تخصیص/نشست کوئری نمی‌شود", async () => {
    planMock.mockResolvedValue(planStatus("free"));

    const data = await getFleetStatusData("user-1", NOW);

    expect(data.capability.hasWorkerAutoApply).toBe(false);
    expect(data.assignedNodes).toBe(0);
    expect(data.freshness.total).toBe(0);
    // مسیرِ ارزان: نه تخصیص خوانده می‌شود نه نشست.
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("Pro: بدونِ ورکر — همان مسیرِ ارزان", async () => {
    planMock.mockResolvedValue(planStatus("pro"));
    const data = await getFleetStatusData("user-1", NOW);
    expect(data.capability.hasWorkerAutoApply).toBe(false);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("Max با یک تخصیص و نشستِ تازه: assignedNodes=۱، anyFresh=true", async () => {
    planMock.mockResolvedValue(planStatus("max"));
    assignMock.mockResolvedValue([{ id: "a1" }] as never);
    // readSessionFreshness: ۱) فهرستِ حساب‌ها، ۲) بلابِ هر حساب (نشستِ تازه = expiresAt آینده).
    pushSelect([{ id: "acc-1" }]); // accounts
    pushSelect([{ expiresAt: new Date(NOW + 60 * 60 * 1000) }]); // blob (تازه)

    const data = await getFleetStatusData("user-1", NOW);

    expect(data.capability.hasWorkerAutoApply).toBe(true);
    expect(data.capability.workerIpLimit).toBe(1);
    expect(data.assignedNodes).toBe(1);
    expect(data.freshness.total).toBe(1);
    expect(data.freshness.anyFresh).toBe(true);
    expect(assignMock).toHaveBeenCalledWith("user-1");
    expect(planMock).toHaveBeenCalledWith("user-1");
  });

  it("Max با نشستِ منقضی: stale شمرده می‌شود (anyFresh=false)", async () => {
    planMock.mockResolvedValue(planStatus("max"));
    assignMock.mockResolvedValue([{ id: "a1" }] as never);
    pushSelect([{ id: "acc-1" }]); // accounts
    pushSelect([{ expiresAt: new Date(NOW - 60 * 1000) }]); // blob (منقضی)

    const data = await getFleetStatusData("user-1", NOW);
    expect(data.freshness.total).toBe(1);
    expect(data.freshness.staleCount).toBe(1);
    expect(data.freshness.anyFresh).toBe(false);
  });

  it("Max بدونِ حسابِ متصل: freshness خالی (total=۰)", async () => {
    planMock.mockResolvedValue(planStatus("max"));
    assignMock.mockResolvedValue([] as never);
    pushSelect([]); // accounts خالی → نشست اصلاً کوئری نمی‌شود

    const data = await getFleetStatusData("user-1", NOW);
    expect(data.assignedNodes).toBe(0);
    expect(data.freshness.total).toBe(0);
    expect(data.freshness.anyFresh).toBe(false);
  });
});
