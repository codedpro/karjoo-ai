/**
 * تست‌های لایه‌ی خواندنِ داده‌ی صفحه‌ی اپلای خودکار (Track A).
 *
 * DB و وابسته‌ها (getAutoApplySettings/getUserPlanStatus/isApplySpecReady) mock می‌شوند
 * — هیچ DB/شبکه‌ی زنده. تمرکز:
 *   • تنظیمات/سهمیه/بوردها/ممیزی در یک بسته جمع می‌شوند، مقید به همان userId.
 *   • hasReadyBoard فقط وقتی true است که حسابِ «connected» با specِ آماده وجود داشته باشد.
 *   • فهرستِ ممیزی فقط ردیف‌های auto_apply_* را برمی‌گرداند (فیلترِ inArray سمتِ DB).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// صف‌های نتیجه‌ی select به‌ترتیبِ فراخوانی: [۱]=boards، [۲]=audit.
const h = vi.hoisted(() => ({ selectResults: [] as unknown[][] }));

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder: Record<string, unknown> = {};
      const ret = () => builder;
      builder.from = ret;
      builder.where = ret;
      // boards به orderBy ختم می‌شود (thenable)؛ audit به limit (Promise).
      builder.orderBy = () => {
        const ob: Record<string, unknown> = {};
        ob.limit = () => Promise.resolve(rows);
        ob.then = (resolve: (r: unknown[]) => unknown) =>
          Promise.resolve(resolve(rows));
        return ob;
      };
      return builder;
    }),
  },
}));
vi.mock("@/lib/apply/auto-apply", () => ({ getAutoApplySettings: vi.fn() }));
vi.mock("@/components/dashboard/plan-data", () => ({ getUserPlanStatus: vi.fn() }));
vi.mock("@/lib/apply/apply-spec", () => ({ isApplySpecReady: vi.fn() }));

import { getAutoApplySettings } from "@/lib/apply/auto-apply";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { isApplySpecReady } from "@/lib/apply/apply-spec";

import { getAutoApplyDashboardData } from "./auto-apply-data";

const settingsMock = vi.mocked(getAutoApplySettings);
const planMock = vi.mocked(getUserPlanStatus);
const specReadyMock = vi.mocked(isApplySpecReady);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function planStatus(apply: unknown) {
  return {
    planKey: "free",
    rawPlan: "free",
    balanceToman: 0,
    grant: { period: "2026-06", granted: false, amountToman: 0 },
    apply,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
  // React cache روی args کلید می‌خورد؛ هر تست userId یکتا می‌دهد تا کش بین تست‌ها تداخل نکند.
});

describe("getAutoApplyDashboardData", () => {
  it("بسته‌ی کامل را مقید به userId جمع می‌کند و hasReadyBoard را درست محاسبه می‌کند", async () => {
    settingsMock.mockResolvedValue({ enabled: true, minScore: 0.8 });
    planMock.mockResolvedValue(
      planStatus({ limit: 100, usedToday: 4, remaining: 96 }),
    );
    // jobinja آماده است؛ jobvision آماده نیست.
    specReadyMock.mockImplementation((b: string) => b === "jobinja");

    pushSelect([
      { board: "jobinja", status: "connected" },
      { board: "jobvision", status: "connected" },
    ]); // boards
    pushSelect([
      {
        id: "ev-1",
        eventType: "auto_apply_enabled",
        metadata: { minScore: 0.8 },
        createdAt: new Date("2026-06-29T10:00:00Z"),
      },
    ]); // audit

    const data = await getAutoApplyDashboardData("user-readyboard");

    expect(data.settings).toEqual({ enabled: true, minScore: 0.8 });
    expect(data.apply).toEqual({ limit: 100, usedToday: 4, remaining: 96 });
    expect(data.boards).toHaveLength(2);
    expect(data.boards[0]).toEqual({
      board: "jobinja",
      status: "connected",
      specReady: true,
    });
    // jobinja متصل + spec آماده → hasReadyBoard.
    expect(data.hasReadyBoard).toBe(true);
    expect(data.audit).toHaveLength(1);
    expect(data.audit[0].eventType).toBe("auto_apply_enabled");

    // مقید به همان userId خوانده شد.
    expect(settingsMock).toHaveBeenCalledWith("user-readyboard");
    expect(planMock).toHaveBeenCalledWith("user-readyboard");
  });

  it("بوردِ آماده اما غیرمتصل (expired) → hasReadyBoard=false", async () => {
    settingsMock.mockResolvedValue({ enabled: false, minScore: 0.7 });
    planMock.mockResolvedValue(
      planStatus({ limit: null, usedToday: 0, remaining: null }),
    );
    specReadyMock.mockReturnValue(true); // spec آماده است…

    pushSelect([{ board: "jobinja", status: "expired" }]); // …اما حساب منقضی است
    pushSelect([]); // بدونِ ممیزی

    const data = await getAutoApplyDashboardData("user-expired");

    expect(data.hasReadyBoard).toBe(false);
    expect(data.boards[0].specReady).toBe(true);
    expect(data.boards[0].status).toBe("expired");
    expect(data.audit).toEqual([]);
  });

  it("هیچ بوردی → hasReadyBoard=false و فهرستِ خالی", async () => {
    settingsMock.mockResolvedValue({ enabled: false, minScore: 0.7 });
    planMock.mockResolvedValue(
      planStatus({ limit: 100, usedToday: 0, remaining: 100 }),
    );
    specReadyMock.mockReturnValue(false);

    pushSelect([]); // boards
    pushSelect([]); // audit

    const data = await getAutoApplyDashboardData("user-noboard");
    expect(data.boards).toEqual([]);
    expect(data.hasReadyBoard).toBe(false);
  });
});
