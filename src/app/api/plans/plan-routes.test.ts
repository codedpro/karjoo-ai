/**
 * تست‌های مسیرهای پلن (Track A): `/api/plans`, `GET /api/me/plan`, `POST /api/me/plan`.
 *
 * نشستِ وب (getCurrentUser)، لایه‌ی وضعیتِ پلن (getUserPlanStatus)، گرنت
 * (grantMonthlyCredits) و DB کاملاً mock می‌شوند — هیچ DB/شبکه‌ی زنده (قاعده‌ی پروژه).
 * تمرکزِ بحرانی:
 *   • /api/plans عمومی است (بدونِ نشست هم پاسخ می‌دهد) و همه‌ی ۴ پلن را برمی‌گرداند.
 *   • مسیرهای /api/me/plan بدونِ نشست → ۴۰۱.
 *   • قاعده‌ی ۴ (دادهٔ هر کاربر فقط برای همان کاربر): تغییرِ پلن همیشه به userIdِ نشست
 *     مقید است؛ هرگز userId از بدنه/کوئری پذیرفته نمی‌شود.
 *   • POST: کلیدِ نامعتبر → ۴۰۰؛ ارتقا → گرنتِ ماهانه؛ پایین‌آوردن → بدونِ گرنت.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // صف‌های نتیجه‌ی select به ترتیبِ فراخوانی (POST یک select پلنِ فعلی می‌زند).
  const selectResults: unknown[][] = [];
  // آخرین مقدارِ set که به db.update داده شد (برای assert تغییرِ پلن).
  const updateState: { lastSet: Record<string, unknown> | null } = { lastSet: null };
  // کارتِ مقصدِ کارت‌به‌کارت: پیش‌فرض پیکربندی‌شده؛ یک تست null می‌کند تا ۵۰۳ را بسنجد.
  const card: { info: { cardNumber: string; holder: string } | null } = {
    info: { cardNumber: "6037-9900-0000-0000", holder: "کارجو" },
  };
  return { selectResults, updateState, card };
});

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/components/dashboard/plan-data", () => ({
  getUserPlanStatus: vi.fn(),
}));
vi.mock("@/lib/billing/grants", () => ({ grantMonthlyCredits: vi.fn() }));
// کارتِ مقصد را کنترل‌پذیر می‌کنیم (بقیه‌ی env واقعی می‌ماند).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, cardToCardInfo: () => h.card.info };
});
// هسته‌ی پرداخت mock می‌شود: ارتقا فقط یک درخواستِ pending می‌سازد (بدونِ تغییرِ پلن).
vi.mock("@/lib/billing/payments", () => ({ createPaymentRequest: vi.fn() }));
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
import { grantMonthlyCredits } from "@/lib/billing/grants";
import { createPaymentRequest } from "@/lib/billing/payments";

import { GET as plansGET } from "@/app/api/plans/route";
import { GET as mePlanGET, POST as mePlanPOST } from "@/app/api/me/plan/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getUserPlanStatusMock = vi.mocked(getUserPlanStatus);
const grantMock = vi.mocked(grantMonthlyCredits);
const createPaymentRequestMock = vi.mocked(createPaymentRequest);
const dbUpdateMock = vi.mocked(db.update);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

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
  h.card.info = { cardNumber: "6037-9900-0000-0000", holder: "کارجو" };
  createPaymentRequestMock.mockResolvedValue({
    id: "pr-1",
    amountToman: 299_000,
    status: "pending",
    targetPlan: "pro",
    createdAt: new Date(0),
  } as never);
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
    expect(pro.monthlyCreditToman).toBe(100_000);
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
  it("بدونِ نشست → ۴۰۱ و هیچ update/گرنتی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(401);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("ارتقا اما کارتِ مقصد پیکربندی‌نشده → ۵۰۳ و هیچ تغییری/درخواستی", async () => {
    h.card.info = null;
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(503);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("کلیدِ پلنِ نامعتبر → ۴۰۰ و هیچ update", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "ultra" }));
    expect(res.status).toBe(400);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("کلیدِ تاریخیِ payg عمداً پذیرفته نمی‌شود → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "payg" }));
    expect(res.status).toBe(400);
  });

  it("ارتقا (free→pro) → درخواستِ کارت‌به‌کارتِ pending (بدونِ تغییرِ پلن/گرنت) و ۲۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "free" }]); // پلنِ فعلیِ کاربر

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(true);
    expect(body.upgraded).toBe(false);
    expect(body.targetPlan).toBe("pro");
    expect(body.card).toBeTruthy();

    // پلن تغییر *نکرد*؛ فقط یک درخواستِ pendingِ kind='plan' با مقصد/قیمت ساخته شد.
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(grantMock).not.toHaveBeenCalled();
    expect(createPaymentRequestMock).toHaveBeenCalledTimes(1);
    const [uid, input] = createPaymentRequestMock.mock.calls[0];
    expect(uid).toBe("user-1");
    expect(input.kind).toBe("plan");
    expect(input.targetPlan).toBe("pro");
    expect(input.amountToman).toBe(299_000);
  });

  it("پایین‌آوردن (max→free) → فوری اعمال می‌شود (بدونِ پرداخت)، upgraded=false", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "max" }]); // پلنِ فعلیِ کاربر گران‌تر است

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "free" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upgraded).toBe(false);
    expect(body.plan).toBe("free");
    // پلن فوری ست می‌شود؛ نه گرنت، نه درخواستِ پرداخت.
    expect(h.updateState.lastSet?.plan).toBe("free");
    expect(grantMock).not.toHaveBeenCalled();
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("ارتقا از پلنِ تاریخیِ payg (=free) به pro → درخواستِ pending (۲۰۱)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([{ plan: "payg" }]); // legacy → معادلِ free (قیمت ۰) → ارتقا

    const res = await mePlanPOST(jsonReq("https://k.app/api/me/plan", { plan: "pro" }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.pending).toBe(true);
    expect(createPaymentRequestMock).toHaveBeenCalledTimes(1);
    expect(dbUpdateMock).not.toHaveBeenCalled();
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
