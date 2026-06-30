/**
 * تست‌های هندلرِ `GET /api/ai-status` (WF3 Track B) — نشست و وضعیتِ نگه‌داری mock.
 *
 * تمرکز:
 *   • بدونِ نشست → ۴۰۱.
 *   • در دسترس → { maintenance:false, reason:null }.
 *   • سقفِ بودجه → { maintenance:true, reason:'cap' } (هیچ مبلغی لو نمی‌رود).
 *   • پرچمِ دستی → reason='manual'.
 *   • خطای خواندنِ وضعیت → fail-open (در دسترس) تا UI قفل نشود.
 *   • هیچ‌جا monthUpstream/cap (مبلغِ خام) در بدنه‌ی پاسخ نیست.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/billing/ai-budget", () => ({ maintenanceStatus: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/http";
import { maintenanceStatus } from "@/lib/billing/ai-budget";
import { GET } from "@/app/api/ai-status/route";

const getUserMock = vi.mocked(getCurrentUser);
const statusMock = vi.mocked(maintenanceStatus);

beforeEach(() => {
  vi.clearAllMocks();
});

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

describe("GET /api/ai-status", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("در دسترس → { maintenance:false, reason:null }", async () => {
    getUserMock.mockResolvedValue(USER);
    statusMock.mockResolvedValue({
      inMaintenance: false,
      manual: false,
      capReached: false,
      monthUpstreamToman: 1000,
      capToman: 2_100_000,
      period: "2026-06",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ maintenance: false, reason: null });
    // هیچ مبلغی نباید لو برود.
    expect(body).not.toHaveProperty("monthUpstreamToman");
    expect(body).not.toHaveProperty("capToman");
  });

  it("سقفِ بودجه رسیده → reason='cap'", async () => {
    getUserMock.mockResolvedValue(USER);
    statusMock.mockResolvedValue({
      inMaintenance: true,
      manual: false,
      capReached: true,
      monthUpstreamToman: 2_200_000,
      capToman: 2_100_000,
      period: "2026-06",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maintenance: true, reason: "cap" });
  });

  it("پرچمِ دستی → reason='manual' (اولویت بر سقف)", async () => {
    getUserMock.mockResolvedValue(USER);
    statusMock.mockResolvedValue({
      inMaintenance: true,
      manual: true,
      capReached: true,
      monthUpstreamToman: 2_200_000,
      capToman: 2_100_000,
      period: "2026-06",
    });
    const res = await GET();
    expect(await res.json()).toEqual({ maintenance: true, reason: "manual" });
  });

  it("خطای خواندنِ وضعیت → fail-open (در دسترس، ۲۰۰)", async () => {
    getUserMock.mockResolvedValue(USER);
    statusMock.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ maintenance: false, reason: null });
  });
});
