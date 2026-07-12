/**
 * تست‌های `POST /api/apply/find-jobs` (Track B، فاز ۲).
 *
 * نشستِ وب (getCurrentUser)، هِلپرِ فیلترها (readApplyFilters)، ارکستریتور
 * (runFilterApply)، پلن/سقف و گیتِ AIِ پولی همگی mock می‌شوند — هیچ DB/شبکه‌ی زنده.
 * تمرکزِ بحرانی:
 *   • بدونِ نشست → ۴۰۱ (هیچ اجرا).
 *   • قاعده‌ی ۴/§۱۰: کاربر همیشه از نشست؛ بدنه userId/کلیدِ اضافه نمی‌پذیرد (→ ۴۰۰).
 *   • بدونِ دسته‌ی انتخاب‌شده → پاسخِ دوستانه reason='no_filters' (بدونِ scrape/enqueue).
 *   • فیلترمودِ پیش‌فرض: runFilterApply با aiFilter=false و dailyCapِ پلن اجرا و
 *     تعدادِ صف‌شده (enqueued) برگردانده می‌شود.
 *   • فیلترِ هوشمند فقط با aiFilterEnabled *و* استحقاقِ AIِ پولی؛ نبودِ استحقاق → مسیرِ پایه.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/apply/filters", () => ({ readApplyFilters: vi.fn() }));
vi.mock("@/lib/apply/orchestrator", () => ({ runFilterApply: vi.fn() }));
vi.mock("@/lib/billing/apply-quota-guard", () => ({ readUserPlan: vi.fn() }));
vi.mock("@/lib/billing/plans", () => ({ applyQuotaFor: vi.fn() }));
vi.mock("@/lib/billing/entitlement", () => ({ assertCanUsePaidAi: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/http";
import { readApplyFilters } from "@/lib/apply/filters";
import { runFilterApply } from "@/lib/apply/orchestrator";
import { readUserPlan } from "@/lib/billing/apply-quota-guard";
import { applyQuotaFor } from "@/lib/billing/plans";
import { assertCanUsePaidAi } from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";

import { POST } from "@/app/api/apply/find-jobs/route";
import { resetRateLimits } from "@/lib/api/rate-limit";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const readFiltersMock = vi.mocked(readApplyFilters);
const runFilterApplyMock = vi.mocked(runFilterApply);
const readUserPlanMock = vi.mocked(readUserPlan);
const applyQuotaForMock = vi.mocked(applyQuotaFor);
const assertAiMock = vi.mocked(assertCanUsePaidAi);

const USER = { id: "user-1", email: "u@x.ir", isActive: true } as never;

/** فیلترِ آماده با دسته‌ها (کاربرِ واجدِ شرطِ اجرا). */
function filtersWith(overrides: Record<string, unknown> = {}) {
  return {
    categorySlugs: ["web-development"],
    cities: [],
    jobTypes: [],
    remoteOnly: false,
    aiFilterEnabled: false,
    ...overrides,
  } as never;
}

/** گزارشِ نمونه‌ی runFilterApply. */
function report(overrides: Record<string, unknown> = {}) {
  return {
    aiFilter: false,
    ingested: 12,
    persistedListings: 12,
    queued: 9,
    alreadyQueued: 3,
    skippedByCap: 0,
    skippedDismissed: 0,
    scored: 0,
    belowThreshold: 0,
    errors: [],
    ...overrides,
  } as never;
}

function req(body?: unknown) {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request("https://k.app/api/apply/find-jobs", init);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits(); // گاردِ نرخ per-user حالتش ماژول‌سطحی است — بین تست‌ها پاک شود.
  getCurrentUserMock.mockResolvedValue(USER);
  readFiltersMock.mockResolvedValue(filtersWith());
  readUserPlanMock.mockResolvedValue("free");
  applyQuotaForMock.mockReturnValue(100);
  runFilterApplyMock.mockResolvedValue(report());
  assertAiMock.mockResolvedValue({ plan: "free", balanceToman: 5000 } as never);
});

describe("POST /api/apply/find-jobs", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ اجرا", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(readFiltersMock).not.toHaveBeenCalled();
    expect(runFilterApplyMock).not.toHaveBeenCalled();
  });

  it("بدونِ دسته‌ی انتخاب‌شده → پاسخِ دوستانه no_filters (بدونِ اجرا)", async () => {
    readFiltersMock.mockResolvedValue(filtersWith({ categorySlugs: [] }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(0);
    expect(body.reason).toBe("no_filters");
    expect(typeof body.message).toBe("string");
    expect(runFilterApplyMock).not.toHaveBeenCalled();
  });

  it("گاردِ نرخ: بیش از ۵ درخواستِ پیاپیِ یک کاربر → ۴۲۹ با Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await POST(req());
      expect(ok.status).toBe(200);
    }
    const limited = await POST(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("فیلترمودِ پیش‌فرض → runFilterApply(aiFilter=false) و enqueued=queued", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(9);
    expect(body.alreadyQueued).toBe(3);
    expect(body.ingested).toBe(12);
    expect(body.aiFilter).toBe(false);

    // مقید به userIdِ نشست (قاعده‌ی ۴)، aiFilter=false، سقفِ روزانه‌ی پلنِ free=۱۰۰.
    expect(runFilterApplyMock).toHaveBeenCalledWith({
      userId: "user-1",
      aiFilter: false,
      dailyCap: 100,
    });
    // چون aiFilterEnabled خاموش است، گیتِ AIِ پولی اصلاً صدا زده نمی‌شود.
    expect(assertAiMock).not.toHaveBeenCalled();
  });

  it("پلنِ نامحدود (applyQuotaFor=null) → dailyCap = MAX_SAFE_INTEGER", async () => {
    readUserPlanMock.mockResolvedValue("max");
    applyQuotaForMock.mockReturnValue(null);
    await POST(req());
    expect(runFilterApplyMock).toHaveBeenCalledWith({
      userId: "user-1",
      aiFilter: false,
      dailyCap: Number.MAX_SAFE_INTEGER,
    });
  });

  it("aiFilterEnabled روشن + واجدِ شرطِ AI → runFilterApply(aiFilter=true)", async () => {
    readFiltersMock.mockResolvedValue(filtersWith({ aiFilterEnabled: true }));
    runFilterApplyMock.mockResolvedValue(report({ aiFilter: true, queued: 4 }));

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiFilter).toBe(true);
    expect(body.enqueued).toBe(4);

    expect(assertAiMock).toHaveBeenCalledWith("user-1");
    expect(runFilterApplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", aiFilter: true }),
    );
  });

  it("aiFilterEnabled روشن ولی بدونِ استحقاقِ AI (موجودیِ ناکافی) → مسیرِ پایه (aiFilter=false)", async () => {
    readFiltersMock.mockResolvedValue(filtersWith({ aiFilterEnabled: true }));
    // فقط «موجودیِ ناکافیِ» typed به مسیرِ پایه برمی‌گردد — AI هرگز اجباری نیست.
    assertAiMock.mockRejectedValue(
      new InsufficientBalanceError({ balanceToman: 0, plan: "free" }),
    );

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(assertAiMock).toHaveBeenCalledWith("user-1");
    expect(runFilterApplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", aiFilter: false }),
    );
  });

  it("aiFilterEnabled روشن ولی svcِ 1xai در دسترس نیست → ۵۰۳ (نه اپلایِ انبوهِ بی‌فیلترِ بی‌صدا)", async () => {
    readFiltersMock.mockResolvedValue(filtersWith({ aiFilterEnabled: true }));
    // خطای زیرساخت (نه استحقاق): کاربری که فیلترِ AI خواسته نباید بی‌صدا بدونِ فیلتر
    // به همه‌ی آگهی‌ها اپلای شود.
    assertAiMock.mockRejectedValue(new Error("OnexaiSvcUnavailableError: svc down"));

    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(runFilterApplyMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی خالی مجاز است (اجرا می‌شود)", async () => {
    const res = await POST(req()); // بدونِ بدنه
    expect(res.status).toBe(200);
    expect(runFilterApplyMock).toHaveBeenCalled();
  });

  it("بدنه با کلیدِ اضافه (مثلِ userIdِ جعلی) → ۴۰۰ و هیچ اجرا (قاعده‌ی ۴)", async () => {
    const res = await POST(req({ userId: "attacker" }));
    expect(res.status).toBe(400);
    expect(runFilterApplyMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی JSON نامعتبر → ۴۰۰", async () => {
    const res = await POST(req("{ not json"));
    expect(res.status).toBe(400);
    expect(runFilterApplyMock).not.toHaveBeenCalled();
  });
});
