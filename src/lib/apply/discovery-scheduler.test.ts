import { beforeEach, describe, expect, it, vi } from "vitest";

import { runServerDiscovery, type EligibleUser } from "@/lib/apply/discovery-scheduler";
import type { RunFilterApplyReport } from "@/lib/apply/orchestrator";

function report(queued: number): RunFilterApplyReport {
  return {
    aiFilter: true,
    ingested: queued,
    persistedListings: queued,
    queued,
    alreadyQueued: 0,
    skippedByCap: 0,
    skippedDismissed: 0,
    scored: queued,
    belowThreshold: 0,
    reachedEnd: false,
    errors: [],
  };
}

const eligible: EligibleUser[] = [
  { userId: "u1", plan: "max" },
  { userId: "u2", plan: "max" },
];

type RunFilterOpts = {
  userId: string;
  aiFilter: boolean;
  threshold: number;
  dailyCap: number;
  db?: unknown;
};

describe("runServerDiscovery", () => {
  // اسپای مُهرِ چرخش — در همه‌ی تست‌ها تزریق می‌شود تا به DBِ واقعی دست نخورد.
  let mark: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mark = vi.fn(async () => {});
  });

  it("برای هر کاربرِ واجدِ شرایط، aiFilter=true با آستانه‌ی minScore اجرا می‌کند", async () => {
    const runFilter = vi.fn(async (_opts: RunFilterOpts) => report(3));
    const summary = await runServerDiscovery({
      listEligible: async () => eligible,
      assertAllowed: async () => ({ minScore: 0.82 }),
      canUsePaidAi: async () => undefined,
      runFilter,
      markAttempted: mark,
    });

    expect(summary.eligible).toBe(2);
    expect(summary.queuedUsers).toBe(2);
    expect(summary.totalQueued).toBe(6);
    expect(runFilter).toHaveBeenCalledTimes(2);
    expect(runFilter.mock.calls[0]?.[0]).toMatchObject({
      userId: "u1",
      aiFilter: true,
      threshold: 0.82,
    });
  });

  it("بی‌موجودیِ AI → کاربر رد می‌شود و runFilter برایش صدا نمی‌شود (fail-closed روی پول)", async () => {
    const runFilter = vi.fn(async (_opts: RunFilterOpts) => report(1));
    const summary = await runServerDiscovery({
      listEligible: async () => eligible,
      assertAllowed: async () => ({ minScore: 0.7 }),
      // u1 موجودی ندارد، u2 دارد.
      canUsePaidAi: async (userId) => {
        if (userId === "u1") throw new Error("insufficient balance");
        return undefined;
      },
      runFilter,
      markAttempted: mark,
    });

    expect(summary.skipped).toBe(1);
    expect(summary.outcomes.find((o) => o.userId === "u1")).toMatchObject({
      status: "skipped",
      reason: "no_ai_balance",
    });
    expect(runFilter).toHaveBeenCalledTimes(1);
    expect(runFilter.mock.calls[0]?.[0]).toMatchObject({ userId: "u2" });
  });

  it("گیتِ سرور رد کند → کاربر skip می‌شود (نه خطا)", async () => {
    const summary = await runServerDiscovery({
      listEligible: async () => [eligible[0]!],
      assertAllowed: async () => {
        throw Object.assign(new Error("disabled"), { code: "disabled" });
      },
      canUsePaidAi: async () => undefined,
      runFilter: vi.fn(async () => report(0)),
      markAttempted: mark,
    });
    expect(summary.skipped).toBe(1);
    expect(summary.outcomes[0]?.status).toBe("skipped");
  });

  it("بودجه‌ی زمان: پس از سررسید می‌ایستد و باقی‌مانده‌ها را deferred می‌شمارد", async () => {
    const runFilter = vi.fn(async (_opts: RunFilterOpts) => report(1));
    // ساعتِ تزریقی: شروع=۰؛ پیش از کاربرِ اول ۰، پیش از کاربرِ دوم ۱۰۰۰۰ (> بودجه‌ی ۵۰۰۰).
    let t = 0;
    const times = [0, 0, 10_000];
    const now = () => (times.length ? (t = times.shift()!) : t);

    const summary = await runServerDiscovery({
      listEligible: async () => eligible, // دو کاربر
      assertAllowed: async () => ({ minScore: 0.7 }),
      canUsePaidAi: async () => undefined,
      runFilter,
      markAttempted: mark,
      budgetMs: 5_000,
      now,
    });

    expect(summary.deadlineHit).toBe(true);
    expect(summary.processed).toBe(1);
    expect(summary.deferred).toBe(1);
    expect(runFilter).toHaveBeenCalledTimes(1); // کاربرِ دوم اصلاً پردازش نشد
    // چرخش: فقط کاربرِ *تلاش‌شده* مُهر می‌خورد (نه معوق‌ها).
    expect(mark).toHaveBeenCalledWith(expect.anything(), ["u1"]);
  });

  it("خطای یک کاربر کلِ دسته را متوقف نمی‌کند (ایزوله‌سازی)", async () => {
    const runFilter = vi.fn(async (opts: { userId: string }) => {
      if (opts.userId === "u1") throw new Error("scrape exploded");
      return report(2);
    });
    const summary = await runServerDiscovery({
      listEligible: async () => eligible,
      assertAllowed: async () => ({ minScore: 0.7 }),
      canUsePaidAi: async () => undefined,
      runFilter,
      markAttempted: mark,
    });

    expect(summary.errors).toBe(1);
    expect(summary.queuedUsers).toBe(1); // u2 با وجودِ شکستِ u1 پردازش شد
    expect(summary.totalQueued).toBe(2);
    expect(summary.outcomes.find((o) => o.userId === "u1")?.status).toBe("error");
    expect(summary.outcomes.find((o) => o.userId === "u2")?.status).toBe("queued");
  });

  it("چرخش: همه‌ی کاربرانِ تلاش‌شده (حتی ردشده‌ها) مُهرِ last_discovery می‌خورند", async () => {
    // u1 بی‌موجودی (رد)، u2 صف — هر دو باید مُهر بخورند تا هیچ‌کس جلوی صف قفل نشود.
    await runServerDiscovery({
      listEligible: async () => eligible,
      assertAllowed: async () => ({ minScore: 0.7 }),
      canUsePaidAi: async (userId) => {
        if (userId === "u1") throw new Error("no balance");
        return undefined;
      },
      runFilter: vi.fn(async (_o: RunFilterOpts) => report(1)),
      markAttempted: mark,
    });

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith(expect.anything(), ["u1", "u2"]);
  });
});
