/**
 * تست‌های لایه‌ی وضعیتِ پلنِ کاربر (`plan-data.ts`) — Track A.
 *
 * DB، کیف‌پولِ واحدِ 1xai (getUnifiedBalance) و شمارشِ اپلای (countAppliesToday) mock
 * می‌شوند — هیچ DB/شبکه‌ی زنده. تمرکز:
 *   • نرمال‌سازیِ پلنِ تاریخی (payg→free) در planKey.
 *   • موجودی = availableTomanِ کیف‌پولِ واحد؛ svc خطادار → ۰ (نمایشی، نه fail-closed).
 *   • وضعیتِ گرنتِ ماهِ جاری از روی وجود/نبودِ ردیفِ دفترِ 'grant' (بدونِ نوشتن).
 *   • پلنِ نامحدود (pro/…): سهمیه null و *بدونِ* کوئریِ شمارشِ اپلای (مسیرِ ارزان).
 *   • پلنِ Free: سهمیه ۱۰۰ و باقی‌مانده درست محاسبه می‌شود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/lib/billing/unified", () => ({ getUnifiedBalance: vi.fn() }));
vi.mock("@/lib/billing/apply-quota", () => ({ countAppliesToday: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder: Record<string, unknown> = {};
      const ret = () => builder;
      builder.from = ret;
      builder.where = ret;
      builder.limit = () => Promise.resolve(rows);
      builder.then = (resolve: (r: unknown[]) => unknown) =>
        Promise.resolve(resolve(rows));
      return builder;
    }),
  },
}));

import { getUnifiedBalance } from "@/lib/billing/unified";
import { countAppliesToday } from "@/lib/billing/apply-quota";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";

const getUnifiedBalanceMock = vi.mocked(getUnifiedBalance);
const countAppliesMock = vi.mocked(countAppliesToday);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

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

// زمانی قطعی برای period (UTC) — ۲۰۲۶-۰۶.
const NOW = Date.UTC(2026, 5, 15);

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

describe("getUserPlanStatus", () => {
  it("Free با گرنتِ اعمال‌نشده: سهمیه ۱۰۰، باقی‌مانده درست، اعتبار ۰", async () => {
    pushSelect([{ plan: "free" }]); // readRawPlan
    pushSelect([]); // readGrantApplied → ردیفِ گرنت نیست
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    countAppliesMock.mockResolvedValue(7);

    const status = await getUserPlanStatus("user-1", NOW);
    expect(status.planKey).toBe("free");
    expect(status.balanceToman).toBe(0);
    expect(status.grant.period).toBe("2026-06");
    expect(status.grant.granted).toBe(false);
    expect(status.grant.amountToman).toBe(0);
    expect(status.apply.limit).toBe(100);
    expect(status.apply.usedToday).toBe(7);
    expect(status.apply.remaining).toBe(93);
    expect(countAppliesMock).toHaveBeenCalledWith("user-1");
  });

  it("پلنِ تاریخیِ payg به free نرمال می‌شود", async () => {
    pushSelect([{ plan: "payg" }]);
    pushSelect([]);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(5_000));
    countAppliesMock.mockResolvedValue(0);

    const status = await getUserPlanStatus("user-1", NOW);
    expect(status.planKey).toBe("free");
    expect(status.rawPlan).toBe("payg");
  });

  it("pro: سهمیه نامحدود (null) و هیچ کوئریِ شمارشِ اپلای زده نمی‌شود", async () => {
    pushSelect([{ plan: "pro" }]);
    pushSelect([{ id: "ledger-1" }]); // گرنتِ این ماه قبلاً اعمال شده
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(120_000));

    const status = await getUserPlanStatus("user-1", NOW);
    expect(status.planKey).toBe("pro");
    expect(status.apply.limit).toBeNull();
    expect(status.apply.usedToday).toBe(0);
    expect(status.apply.remaining).toBeNull();
    expect(status.grant.granted).toBe(true);
    // پس از اتحاد با 1xai هیچ اعتبارِ ماهانه‌ای وجود ندارد — monthlyCreditToman همه‌جا ۰.
    expect(status.grant.amountToman).toBe(0);
    // مسیرِ ارزانِ پلنِ نامحدود: شمارشِ اپلای صدا نمی‌شود.
    expect(countAppliesMock).not.toHaveBeenCalled();
  });

  it("کیف‌پولِ واحدِ خطادار → ۰ (نمایشی؛ هرگز throw نمی‌کند)", async () => {
    pushSelect([{ plan: "free" }]);
    pushSelect([]);
    getUnifiedBalanceMock.mockRejectedValue(new Error("svc down"));
    countAppliesMock.mockResolvedValue(0);

    const status = await getUserPlanStatus("user-1", NOW);
    expect(status.balanceToman).toBe(0);
  });

  it("کاربرِ یافت‌نشده → پلنِ پیش‌فرضِ free", async () => {
    pushSelect([]); // readRawPlan → ردیفی نیست
    pushSelect([]);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    countAppliesMock.mockResolvedValue(0);

    const status = await getUserPlanStatus("user-1", NOW);
    expect(status.planKey).toBe("free");
    expect(status.rawPlan).toBe("free");
  });
});
