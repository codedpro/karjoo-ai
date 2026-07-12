/**
 * تست‌های هندلرهای `/api/wallet`, `/api/wallet/topup`, `/api/usage` (Track B).
 *
 * نشستِ وب (getCurrentUser)، کیف‌پولِ واحدِ 1xai (getUnifiedBalance) و DB کاملاً mock
 * می‌شوند — هیچ DB/شبکه‌ی زنده (قاعده‌ی پروژه). تمرکزِ بحرانی:
 *   • همه‌ی مسیرها بدونِ نشست → ۴۰۱ (gate شده).
 *   • قاعده‌ی ۴ (دادهٔ هر کاربر فقط برای همان کاربر): کوئری همیشه به userIdِ نشست
 *     مقید است، نه از بدنه/کوئری؛ هرگز userId از کلاینت پذیرفته نمی‌شود.
 *   • wallet: موجودی = availableTomanِ کیف‌پولِ واحد؛ svc/گره در دسترس نبود → ۵۰۳
 *     (fail-closed — هرگز موجودیِ جعلی)؛ دفترِ محلی به‌عنوانِ تاریخچه می‌ماند.
 *   • topup: *بازنشسته* — پس از احراز (۴۰۱ اول)، همیشه ۴۱۰ + topupUrlِ 1xai.
 *   • usage: صفحه‌بندی/فیلتر اعتبارسنجی می‌شود و به DB مقید به userId می‌رسد.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // صف‌های نتیجه‌ی select به ترتیبِ فراخوانی (هر route چند select می‌زند).
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
// کیف‌پولِ واحد: getUnifiedBalance جعلی + همان کلاسِ OnexaiLinkError برای instanceof.
vi.mock("@/lib/billing/unified", () => {
  class OnexaiLinkError extends Error {
    constructor(message = "link failed") {
      super(message);
      this.name = "OnexaiLinkError";
    }
  }
  return { getUnifiedBalance: vi.fn(), OnexaiLinkError };
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
      builder.innerJoin = ret;
      builder.limit = () => {
        // اگر offset بعد از limit نیاید، خودِ limit نتیجه را resolve می‌کند.
        return Object.assign(Promise.resolve(rows), builder);
      };
      builder.offset = () => Promise.resolve(rows);
      // اجازه‌ی await مستقیم روی builder (برای کوئری‌های بدونِ limit).
      builder.then = (resolve: (r: unknown[]) => unknown) =>
        Promise.resolve(resolve(rows));
      return builder;
    }),
  },
}));

import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth/http";
import { getUnifiedBalance, OnexaiLinkError } from "@/lib/billing/unified";
import { OnexaiSvcUnavailableError } from "@/lib/onexai/svc";

import { GET as walletGET } from "@/app/api/wallet/route";
import { POST as topupPOST } from "@/app/api/wallet/topup/route";
import { GET as usageGET } from "@/app/api/usage/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getUnifiedBalanceMock = vi.mocked(getUnifiedBalance);
const dbSelectMock = vi.mocked(db.select);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

/** موجودیِ واحدِ جعلی — گیت/نمایش روی availableToman است. */
function poolBalance(availableToman: number) {
  return {
    balanceToman: availableToman,
    heldToman: 0,
    availableToman,
    isActive: true,
    unlimited: false,
  };
}

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function getReq(url: string) {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

/* ─────────────────────────────  GET /api/wallet  ───────────────────────────── */

describe("GET /api/wallet", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(401);
    expect(getUnifiedBalanceMock).not.toHaveBeenCalled();
  });

  it("موجودیِ واحد (availableToman) + پلن + دفتر را برمی‌گرداند (مقید به userIdِ نشست)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(120_000));
    pushSelect([{ plan: "payg" }]); // select پلن
    pushSelect([
      {
        id: "l-1",
        kind: "topup",
        amountToman: 100_000,
        balanceAfterToman: 120_000,
        refType: "dev_topup",
        description: "شارژ",
        createdAt: new Date("2026-06-30"),
      },
    ]); // select دفتر (تاریخچه‌ی محلی)

    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceToman).toBe(120_000);
    expect(body.plan).toBe("payg");
    expect(body.ledger).toHaveLength(1);
    expect(body.ledger[0].kind).toBe("topup");
    // موجودی با userIdِ نشست خوانده شد (نه از کوئری).
    expect(getUnifiedBalanceMock).toHaveBeenCalledWith("user-1");
  });

  it("svcِ 1xai در دسترس نیست → ۵۰۳ (هرگز موجودیِ جعلی)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUnifiedBalanceMock.mockRejectedValue(new OnexaiSvcUnavailableError());
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("1xai");
    // هیچ select پلن/دفتری پس از شکستِ موجودی زده نشد.
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("گره به استخر برقرار نشد (OnexaiLinkError) → ۵۰۳", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUnifiedBalanceMock.mockRejectedValue(new OnexaiLinkError("ایمیل ندارد"));
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(503);
  });

  it("خطای ناشناخته‌ی موجودی → ۵۰۰ (نه ۵۰۳ — فقط خطاهای typed نگاشت می‌شوند)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUnifiedBalanceMock.mockRejectedValue(new Error("boom"));
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(500);
  });

  it("ledgerLimit نامعتبر (>۵۰) → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await walletGET(getReq("https://k.app/api/wallet?ledgerLimit=999"));
    expect(res.status).toBe(400);
    expect(getUnifiedBalanceMock).not.toHaveBeenCalled();
  });

  it("پلنِ پیش‌فرض payg اگر ردیفِ کاربر یافت نشد", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getUnifiedBalanceMock.mockResolvedValue(poolBalance(0));
    pushSelect([]); // پلن نیست
    pushSelect([]); // دفتر خالی
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plan).toBe("payg");
    expect(body.balanceToman).toBe(0);
    expect(body.ledger).toEqual([]);
  });
});

/* ─────────────────────────  POST /api/wallet/topup  ────────────────────────── */

describe("POST /api/wallet/topup (بازنشسته — ۴۱۰)", () => {
  it("بدونِ نشست → ۴۰۱ (احراز قبل از ۴۱۰)", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await topupPOST();
    expect(res.status).toBe(401);
  });

  it("با نشست → همیشه ۴۱۰ + پیام و topupUrlِ 1xai", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await topupPOST();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("شارژ از داشبوردِ 1xai انجام می‌شود");
    expect(body.topupUrl).toBe("https://1xai.ir/topup");
    // هیچ حرکتی روی پول/DB — کارجو دیگر پول نمی‌گیرد.
    expect(getUnifiedBalanceMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────  GET /api/usage  ────────────────────────────── */

describe("GET /api/usage", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await usageGET(getReq("https://k.app/api/usage"));
    expect(res.status).toBe(401);
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("رکوردهای مصرف را صفحه‌بندی‌شده برمی‌گرداند", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([
      {
        id: "u-1",
        kind: "match",
        provider: "openai",
        modelId: "gpt-4o-mini",
        promptTokens: 800,
        completionTokens: 200,
        costToman: 350,
        createdAt: new Date("2026-06-30"),
      },
    ]);

    const res = await usageGET(getReq("https://k.app/api/usage?limit=10&offset=0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(body.usage[0].modelId).toBe("gpt-4o-mini");
    expect(body.usage[0].costToman).toBe(350);
  });

  it("kind نامعتبر → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await usageGET(getReq("https://k.app/api/usage?kind=bogus"));
    expect(res.status).toBe(400);
    expect(dbSelectMock).not.toHaveBeenCalled();
  });

  it("limit خارج از بازه (>۱۰۰) → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await usageGET(getReq("https://k.app/api/usage?limit=500"));
    expect(res.status).toBe(400);
  });

  it("kind معتبر فیلتر را اعمال می‌کند و ۲۰۰ می‌دهد", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    pushSelect([]);
    const res = await usageGET(getReq("https://k.app/api/usage?kind=cover_letter"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.usage).toEqual([]);
    expect(dbSelectMock).toHaveBeenCalled();
  });
});
