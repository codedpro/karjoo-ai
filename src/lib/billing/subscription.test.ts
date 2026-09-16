/**
 * تست‌های خواندنِ مزایا از اشتراکِ 1xai (subscription.ts) — db جعلی + svcِ تزریقی.
 *
 * تضمین‌ها:
 *   • کشِ ۶۰ ثانیه‌ای به‌ازای کاربر (در این بازه svc دوباره صدا نمی‌شود).
 *   • fresh کش را دور می‌زند.
 *   • خطای svc/گره → مزایای رایگان با unavailable=true (هرگز مزیتِ پولیِ تأییدنشده).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { clearEntitlementsCache, readEntitlements } from "@/lib/billing/subscription";
import { FREE_ENTITLEMENTS } from "@/lib/billing/entitlements";
import type { OnexaiSubscription } from "@/lib/onexai/svc";

/** dbِ جعلی: هر select ردیفِ کاربرِ گره‌خورده (onexaiUserId=72) را برمی‌گرداند. */
function makeDb(rows: unknown[] = [{ onexaiUserId: 72, email: "u@x.ir", googleSub: null }]) {
  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  });
  return { select };
}

const PRO_SUB: OnexaiSubscription = {
  planKey: "pro",
  nameFa: "حرفه‌ای",
  status: "active",
  periodEnd: new Date("2026-10-01T00:00:00Z"),
  features: { karjoo_unlimited_applies: true, karjoo_worker_ips: 1 },
};

const resolveUserFn = vi.fn(async () => {
  throw new Error("نباید صدا شود — کاربر گره دارد");
});

beforeEach(() => {
  vi.clearAllMocks();
  clearEntitlementsCache();
});

describe("readEntitlements", () => {
  it("اشتراک را از 1xai می‌خواند و به مزایا نگاشت می‌کند", async () => {
    const db = makeDb();
    const getPoolSubscriptionFn = vi.fn(async () => PRO_SUB);

    const e = await readEntitlements("u1", {
      db: db as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
      now: () => 1_000,
    });

    expect(getPoolSubscriptionFn).toHaveBeenCalledWith(72);
    expect(e).toMatchObject({
      planKey: "pro",
      planNameFa: "حرفه‌ای",
      status: "active",
      unlimitedApplies: true,
      workerIpLimit: 1,
    });
    expect(e.unavailable).toBeUndefined();
  });

  it("کش: در ۶۰ ثانیه svc دوباره صدا نمی‌شود؛ پس از آن تازه خوانده می‌شود", async () => {
    const db = makeDb();
    const getPoolSubscriptionFn = vi.fn(async () => PRO_SUB);
    const deps = (t: number) => ({
      db: db as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
      now: () => t,
    });

    const first = await readEntitlements("u1", deps(0));
    const hit = await readEntitlements("u1", deps(59_999));
    expect(hit).toBe(first);
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);

    await readEntitlements("u1", deps(60_000));
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(2);
  });

  it("کش به‌ازای کاربر است", async () => {
    const getPoolSubscriptionFn = vi.fn(async () => PRO_SUB);
    const deps = {
      db: makeDb() as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
      now: () => 0,
    };
    await readEntitlements("u1", deps);
    await readEntitlements("u2", deps);
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(2);
  });

  it("fresh کش را دور می‌زند و مقدارِ تازه را کش می‌کند", async () => {
    const getPoolSubscriptionFn = vi
      .fn<(id: number) => Promise<OnexaiSubscription>>()
      .mockResolvedValueOnce({ ...PRO_SUB, features: {} })
      .mockResolvedValueOnce(PRO_SUB);
    const base = {
      db: makeDb() as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
      now: () => 0,
    };

    const before = await readEntitlements("u1", base);
    expect(before.workerIpLimit).toBe(0);

    const fresh = await readEntitlements("u1", { ...base, fresh: true });
    expect(fresh.workerIpLimit).toBe(1);
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(2);

    // خواندنِ بعدی (بدونِ fresh) مقدارِ تازه را از کش می‌گیرد.
    const cached = await readEntitlements("u1", base);
    expect(cached.workerIpLimit).toBe(1);
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(2);
  });

  it("خطای svc → مزایای رایگان با unavailable=true (و کش نمی‌شود)", async () => {
    const getPoolSubscriptionFn = vi
      .fn<(id: number) => Promise<OnexaiSubscription>>()
      .mockRejectedValueOnce(new Error("svc down"))
      .mockResolvedValueOnce(PRO_SUB);
    const deps = {
      db: makeDb() as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
      now: () => 0,
    };

    const e = await readEntitlements("u1", deps);
    expect(e).toEqual({ ...FREE_ENTITLEMENTS, unavailable: true });

    // شکست کش نشد: خواندنِ بعدی دوباره تلاش می‌کند.
    const again = await readEntitlements("u1", deps);
    expect(again.workerIpLimit).toBe(1);
    expect(getPoolSubscriptionFn).toHaveBeenCalledTimes(2);
  });

  it("گره برقرار نشد (کاربر ایمیل ندارد) → رایگان با unavailable=true، svc صدا نمی‌شود", async () => {
    const getPoolSubscriptionFn = vi.fn(async () => PRO_SUB);
    const e = await readEntitlements("u1", {
      db: makeDb([{ onexaiUserId: null, email: null, googleSub: null }]) as never,
      resolveUserFn: resolveUserFn as never,
      getPoolSubscriptionFn,
    });
    expect(e.unavailable).toBe(true);
    expect(e.workerIpLimit).toBe(0);
    expect(e.unlimitedApplies).toBe(false);
    expect(getPoolSubscriptionFn).not.toHaveBeenCalled();
  });
});
