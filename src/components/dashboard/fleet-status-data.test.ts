/**
 * تست‌های لایه‌ی وضعیتِ سرورِ اپلایِ کاربر (`fleet-status-data.ts`) — Track C.
 *
 * DB، وضعیتِ پلن (getUserPlanStatus) و فهرستِ تخصیص (listAssignments) mock می‌شوند —
 * هیچ DB/شبکه‌ی زنده. تمرکز:
 *   • Free/Pro (بدونِ ورکر): مسیرِ ارزان — تخصیص/نشست اصلاً کوئری نمی‌شود.
 *   • Max: تعدادِ نودهای تخصیص‌یافته و تازگیِ نشست درست جمع می‌شوند.
 *   • قاعده‌ی ۴: داده مقید به همان userId است (پلن/تخصیص با همان id خوانده می‌شوند).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/components/dashboard/plan-data", () => ({ getUserPlanStatus: vi.fn() }));
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

import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { listAssignments } from "@/lib/fleet/assign";
import { getFleetStatusData } from "@/components/dashboard/fleet-status-data";

const planMock = vi.mocked(getUserPlanStatus);
const assignMock = vi.mocked(listAssignments);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);

/** کمکی: یک UserPlanStatus کمینه با پلنِ دلخواه. */
function planStatus(rawPlan: string) {
  return {
    planKey: rawPlan,
    rawPlan,
    balanceToman: 0,
    grant: { period: "2026-06", granted: false, amountToman: 0 },
    apply: { limit: null, usedToday: 0, remaining: null },
  } as unknown as Awaited<ReturnType<typeof getUserPlanStatus>>;
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
