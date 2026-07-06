/**
 * تست‌های هندلرهای `/api/wallet`, `/api/wallet/topup`, `/api/usage` (Track B).
 *
 * نشستِ وب (getCurrentUser)، هسته‌ی بیلینگ (getBalance/credit) و DB کاملاً mock می‌شوند
 * — هیچ DB/شبکه‌ی زنده (قاعده‌ی پروژه). تمرکزِ بحرانی:
 *   • همه‌ی مسیرها بدونِ نشست → ۴۰۱ (gate شده).
 *   • قاعده‌ی ۴ (دادهٔ هر کاربر فقط برای همان کاربر): کوئری/شارژ همیشه به userIdِ نشست
 *     مقید است، نه از بدنه/کوئری؛ هرگز userId از کلاینت پذیرفته نمی‌شود.
 *   • topup: اعتبارسنجیِ مبلغ (کمینه/بیشینه/غیرعدد → ۴۰۰)؛ مبلغِ معتبر → credit(topup).
 *   • usage/wallet: صفحه‌بندی/فیلتر اعتبارسنجی می‌شود و به DB مقید به userId می‌رسد.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // صف‌های نتیجه‌ی select به ترتیبِ فراخوانی (هر route چند select می‌زند).
  const selectResults: unknown[][] = [];
  // کارتِ مقصدِ کارت‌به‌کارت: پیش‌فرض پیکربندی‌شده؛ یک تست null می‌کند تا ۵۰۳ را بسنجد.
  const card: { info: { cardNumber: string; holder: string } | null } = {
    info: { cardNumber: "6037-9900-0000-0000", holder: "کارجو" },
  };
  return { selectResults, card };
});

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/billing/wallet", () => ({
  getBalance: vi.fn(),
  credit: vi.fn(),
}));
// کارتِ مقصد را کنترل‌پذیر می‌کنیم (بقیه‌ی env واقعی می‌ماند).
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, cardToCardInfo: () => h.card.info };
});
// هسته‌ی پرداخت mock می‌شود: topup فقط یک درخواستِ pending می‌سازد (هیچ creditی).
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
import { credit, getBalance } from "@/lib/billing/wallet";
import { createPaymentRequest } from "@/lib/billing/payments";

import { GET as walletGET } from "@/app/api/wallet/route";
import { POST as topupPOST } from "@/app/api/wallet/topup/route";
import { GET as usageGET } from "@/app/api/usage/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getBalanceMock = vi.mocked(getBalance);
const creditMock = vi.mocked(credit);
const createPaymentRequestMock = vi.mocked(createPaymentRequest);
const dbSelectMock = vi.mocked(db.select);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function getReq(url: string) {
  return new Request(url, { method: "GET" });
}

function jsonReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
  h.card.info = { cardNumber: "6037-9900-0000-0000", holder: "کارجو" };
  createPaymentRequestMock.mockResolvedValue({
    id: "pr-1",
    amountToman: 100_000,
    status: "pending",
    referenceCode: "12345",
    createdAt: new Date(0),
  } as never);
});

/* ─────────────────────────────  GET /api/wallet  ───────────────────────────── */

describe("GET /api/wallet", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(401);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it("موجودی + پلن + دفتر را برمی‌گرداند (مقید به userIdِ نشست)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getBalanceMock.mockResolvedValue(120_000);
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
    ]); // select دفتر

    const res = await walletGET(getReq("https://k.app/api/wallet"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanceToman).toBe(120_000);
    expect(body.plan).toBe("payg");
    expect(body.ledger).toHaveLength(1);
    expect(body.ledger[0].kind).toBe("topup");
    // موجودی با userIdِ نشست خوانده شد (نه از کوئری).
    expect(getBalanceMock).toHaveBeenCalledWith("user-1");
  });

  it("ledgerLimit نامعتبر (>۵۰) → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await walletGET(getReq("https://k.app/api/wallet?ledgerLimit=999"));
    expect(res.status).toBe(400);
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it("پلنِ پیش‌فرض payg اگر ردیفِ کاربر یافت نشد", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getBalanceMock.mockResolvedValue(0);
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

describe("POST /api/wallet/topup", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ درخواستی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await topupPOST(jsonReq("https://k.app/api/wallet/topup", { amountToman: 100_000 }));
    expect(res.status).toBe(401);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("کارتِ مقصد پیکربندی‌نشده → ۵۰۳ و هیچ درخواستی", async () => {
    h.card.info = null;
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await topupPOST(
      jsonReq("https://k.app/api/wallet/topup", { amountToman: 100_000, referenceCode: "12345" }),
    );
    expect(res.status).toBe(503);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("مبلغ + کدِ پیگیریِ معتبر → درخواستِ pending (بدونِ credit) و ۲۰۱", async () => {
    getCurrentUserMock.mockResolvedValue(USER);

    const res = await topupPOST(
      jsonReq("https://k.app/api/wallet/topup", { amountToman: 100_000, referenceCode: "12345" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pending).toBe(true);
    expect(body.request.status).toBe("pending");
    expect(body.card).toBeTruthy();

    // createPaymentRequest با userIdِ نشست + kind='topup' صدا شد (نه از بدنه)؛ هیچ credit.
    expect(createPaymentRequestMock).toHaveBeenCalledTimes(1);
    const [userId, input] = createPaymentRequestMock.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(input.kind).toBe("topup");
    expect(input.amountToman).toBe(100_000);
    expect(input.referenceCode).toBe("12345");
    expect(creditMock).not.toHaveBeenCalled();
  });

  it("مبلغِ زیرِ کمینه → ۴۰۰ و هیچ creditی", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await topupPOST(jsonReq("https://k.app/api/wallet/topup", { amountToman: 500 }));
    expect(res.status).toBe(400);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("مبلغِ بالای بیشینه → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await topupPOST(
      jsonReq("https://k.app/api/wallet/topup", { amountToman: 999_999_999 }),
    );
    expect(res.status).toBe(400);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("مبلغِ غیرعدد → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await topupPOST(
      jsonReq("https://k.app/api/wallet/topup", { amountToman: "abc" }),
    );
    expect(res.status).toBe(400);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی JSON نامعتبر → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const req = new Request("https://k.app/api/wallet/topup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await topupPOST(req);
    expect(res.status).toBe(400);
    expect(createPaymentRequestMock).not.toHaveBeenCalled();
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
