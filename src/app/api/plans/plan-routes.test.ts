/**
 * تست‌های مسیرهای پلن (Track A): `/api/plans`, `GET /api/me/plan`, `POST /api/me/plan`.
 *
 * نشستِ وب (getCurrentUser)، لایه‌ی وضعیتِ پلن (getUserPlanStatus)، کیف‌پولِ واحدِ
 * 1xai (debitUnified) و DB کاملاً mock می‌شوند — هیچ DB/شبکه‌ی زنده (قاعده‌ی پروژه).
 * تمرکزِ بحرانی:
 *   • /api/plans عمومی است (بدونِ نشست هم پاسخ می‌دهد) و همه‌ی ۴ پلن را برمی‌گرداند.
 *   • مسیرهای /api/me/plan بدونِ نشست → ۴۰۱.
 *   • قاعده‌ی ۴ (دادهٔ هر کاربر فقط برای همان کاربر): تغییرِ پلن همیشه به userIdِ نشست
 *     مقید است؛ هرگز userId از بدنه/کوئری پذیرفته نمی‌شود.
 *   • POST: کلیدِ نامعتبر → ۴۰۰؛ ارتقا → debitِ فوری از کیف‌پولِ واحد با referenceِ
 *     پایدارِ `plan:{userId}:{plan}:{YYYY-MM}` و *بعد* ثبتِ پلن؛ موجودیِ ناکافی → ۴۰۲
 *     + topupUrl؛ svc در دسترس نبود → ۵۰۳ (fail-closed)؛ پایین‌آوردن → بدونِ debit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // صف‌های نتیجه‌ی select به ترتیبِ فراخوانی (POST یک select پلنِ فعلی می‌زند).
  const selectResults: unknown[][] = [];
  // آخرین مقدارِ set که به db.update داده شد (برای assert تغییرِ پلن).
  const updateState: { lastSet: Record<string, unknown> | null } = { lastSet: null };
  return { selectResults, updateState };
});

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/components/dashboard/plan-data", () => ({
  getUserPlanStatus: vi.fn(),
}));
// کیف‌پولِ واحد: debitUnified جعلی + همان کلاسِ OnexaiLinkError برای instanceof.
vi.mock("@/lib/billing/unified", () => {
  class OnexaiLinkError extends Error {
    constructor(message = "link failed") {
      super(message);
      this.name = "OnexaiLinkError";
    }
  }
  return { debitUnified: vi.fn(), OnexaiLinkError };
});
// کلاینتِ svc فقط برای کلاسِ خطا mock می‌شود (بدونِ env/شبکه).
vi.mock("@/lib/onexai/svc", () => {
  class OnexaiSvcUnavailableError extends Error {
    constructor(message = "svc unavailable") {
      super(message);
      this.name = "OnexaiSvcUnavailableError";
    }
  }
  return { OnexaiSvcUnavailableError };
});
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder: Record<string, unknown> = {};
      const ret = () => builder;
      builder.from = ret;
      builder.where = ret;
      builder.orderBy = ret;
      builder.limit = () => Promise.resolve(rows);
      builder.then = (resolve: (r: unknown[]) => unknown) =>
        Promise.resolve(resolve(rows));
      return builder;
    }),
    update: vi.fn(() => {
      const builder: Record<string, unknown> = {};
      builder.set = (s: Record<string, unknown>) => {
        h.updateState.lastSet = s;
        return builder;
      };
      builder.where = () => Promise.resolve(undefined);
      return builder;
    }),
  },
}));

import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth/http";
import { getUserPlanStatus } from "@/components/dashboard/plan-data";
import { debitUnified, OnexaiLinkError } from "@/lib/billing/unified";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";
import { InsufficientBalanceError } from "@/lib/billing/errors";

import { GET as plansGET } from "@/app/api/plans/route";
import { GET as mePlanGET, POST as mePlanPOST } from "@/app/api/me/plan/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getUserPlanStatusMock = vi.mocked(getUserPlanStatus);
const debitUnifiedMock = vi.mocked(debitUnified);
const dbUpdateMock = vi.mocked(db.update);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

/** YYYY-MMِ جاری (UTC) — باید با periodMonthOf در route یکی باشد (referenceِ پایدار). */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function jsonReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseStatus(over: Record<string, unknown> = {}) {
  return {
    planKey: "free",
    rawPlan: "free",
    balanceToman: 0,
    grant: { period: "2026-06", granted: false, amountToman: 0 },
    apply: { limit: 100, usedToday: 3, remaining: 97 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
  h.updateState.lastSet = null;
  debitUnifiedMock.mockResolvedValue({ balanceToman: 201_000, already: false });
});

/* ─────────────────────────────  GET /api/plans  ───────────────────────────── */

describe("GET /api/plans", () => {
  it("بدونِ نشست هم همه‌ی ۴ پلن را برمی‌گرداند (عمومی)", async () => {
    const res = await plansGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.plans).toHaveLength(4);
    const keys = body.plans.map((p: { key: string }) => p.key);
    expect(keys).toEqual(["free", "pro", "max", "maxplus"]);
    // فیلدهای نمایشیِ کلیدی موجودند.
    const pro = body.plans.find((p: { key: string }) => p.key === "pro");
    expect(pro.priceToman).toBe(299_000);
    expect(pro.monthlyCreditToman).toBe(0); // کیف‌پولِ واحد — هیچ پلنی اعتبارِ ماهانه ندارد.
    expect(Array.isArray(pro.features)).toBe(true);
  });
});

/* ─────────────────────────────  GET /api/me/plan  ─────────────────────────── */

describe("GET /api/me/plan", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await mePlanGET();
    expect(res.status).toBe(401);
    expect(getUserPlanStatusMock).not.toHaveBeenCalled();
  });

  it("پلن + گرنت + اپلای + موجودی را مقید به userIdِ نشست برمی‌گرداند", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUserPlanStatusMock.mockResolvedValue(
      baseStatus({
        planKey: "pro",
        rawPlan: "pro",
        balanceToman: 150_000,
        grant: { period: "2026-06", granted: true, amountToman: 100_000 },
        apply: { limit: null, usedToday: 0, remaining: null },
      }) as never,
    );

    const res = await mePlanGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toBe("pro");
    expect(body.definition.priceToman).toBe(299_000);
    expect(body.balanceToman).toBe(150_000);
    expect(body.grant.granted).toBe(true);
    expect(body.apply.limit).toBeNull();
    // وضعیت با userIdِ نشست خوانده شد (نه از کوئری).
    expect(getUserPlanStatusMock).toHaveBeenCalledWith("user-1");
  });
});

/* ─────────────────────────────  POST /api/me/plan  ────────────────────────── */

describe("POST /api/me/plan", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ update/debit", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(401);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(debitUnifiedMock).not.toHaveBeenCalled();
  });

  it("کلیدِ پلنِ نامعتبر → ۴۰۰ و هیچ update/debit", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "ultra" }));
    expect(res.status).toBe(400);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(debitUnifiedMock).not.toHaveBeenCalled();
  });

  it("کلیدِ تاریخیِ payg عمداً پذیرفته نمی‌شود → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "payg" }));
    expect(res.status).toBe(400);
  });

  it("ارتقا (free→pro) → debit با referenceِ پایدار، سپس ثبتِ پلن → ۲۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]); // پلنِ فعلیِ کاربر

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.upgraded).toBe(true);
    expect(body.plan).toBe("pro");
    expect(body.balanceToman).toBe(201_000);

    // debit با userIdِ نشست، قیمتِ پلنِ مقصد و referenceِ پایدارِ per-رویداد (بدونِ زمانِ لحظه‌ای).
    expect(debitUnifiedMock).toHaveBeenCalledTimes(1);
    expect(debitUnifiedMock).toHaveBeenCalledWith(
      "user-1",
      299_000,
      `plan:user-1:pro:${currentPeriod()}`,
    );
    // پلن *پس از* debit ست شد.
    expect(dbUpdateMock).toHaveBeenCalledTimes(1);
    expect(h.updateState.lastSet?.plan).toBe("pro");
  });

  it("ارتقا با موجودیِ ناکافی → ۴۰۲ + topupUrlِ 1xai، بدونِ تغییرِ پلن", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]);
    debitUnifiedMock.mockRejectedValue(
      new InsufficientBalanceError({ balanceToman: 1_000, plan: "free" }),
    );

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.topupUrl).toBe("https://1xai.ir/topup");
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("ارتقا اما svcِ 1xai در دسترس نیست → ۵۰۳ (fail-closed)، بدونِ تغییرِ پلن", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]);
    debitUnifiedMock.mockRejectedValue(new OnexaiSvcUnavailableError());

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(503);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("ارتقا اما گره به استخر برقرار نشد (OnexaiLinkError) → ۵۰۳", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]);
    debitUnifiedMock.mockRejectedValue(new OnexaiLinkError("ایمیل ندارد"));

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(503);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it("پایین‌آوردن (max→free) → فوری و بدونِ debit، upgraded=false", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "max" }]); // پلنِ فعلیِ کاربر گران‌تر است

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "free" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upgraded).toBe(false);
    expect(body.plan).toBe("free");
    // پلن فوری ست می‌شود؛ هیچ حرکتی روی کیف‌پولِ واحد.
    expect(h.updateState.lastSet?.plan).toBe("free");
    expect(debitUnifiedMock).not.toHaveBeenCalled();
  });

  it("ارتقا از پلنِ تاریخیِ payg (=free، قیمت ۰) به pro → debit + ثبتِ پلن (۲۰۰)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "payg" }]); // legacy → معادلِ free (قیمت ۰) → ارتقا

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upgraded).toBe(true);
    expect(debitUnifiedMock).toHaveBeenCalledTimes(1);
    expect(h.updateState.lastSet?.plan).toBe("pro");
  });

  it("بدنه‌ی JSON نامعتبر → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const req = new Request("https://k.app/api/me/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await mePlanPOST(req);
    expect(res.status).toBe(400);
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });
});
