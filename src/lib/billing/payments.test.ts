/**
 * تست‌های هسته‌ی پرداختِ کارت‌به‌کارت (payments.ts).
 *
 * تمرکزِ بحرانی (امنیت): اعتبار/پلن *فقط* در approvePaymentRequest (تأییدِ ادمین) تغییر
 * می‌کند، تأیید ایدمپوتنت است (درخواستِ approved دوباره credit نمی‌شود)، و رد فقط روی
 * درخواستِ pending اثر دارد. یک fake dbِ کوچک زنجیره‌ی Drizzle + transaction را تقلید می‌کند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/wallet", () => ({ credit: vi.fn() }));
vi.mock("@/lib/billing/grants", () => ({ grantMonthlyCredits: vi.fn() }));

import { credit } from "@/lib/billing/wallet";
import { grantMonthlyCredits } from "@/lib/billing/grants";
import {
  approvePaymentRequest,
  createPaymentRequest,
  rejectPaymentRequest,
} from "@/lib/billing/payments";

const creditMock = vi.mocked(credit);
const grantMock = vi.mocked(grantMonthlyCredits);

type Row = Record<string, unknown> & { status?: string };

/** نتیجه‌ی .limit() که هم await می‌شود و هم .for() دارد (برای FOR UPDATE). */
function limitResult(rows: Row[]) {
  const p = Promise.resolve(rows) as Promise<Row[]> & { for: () => Promise<Row[]> };
  p.for = () => Promise.resolve(rows);
  return p;
}

/** یک db/txِ جعلیِ کمینه که فقط فراخوانی‌های payments.ts را پشتیبانی می‌کند. */
function makeDb(initialRow: Row | null) {
  const state: { row: Row | null } = { row: initialRow };

  const select = () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => limitResult(state.row ? [state.row] : []),
    };
    return chain;
  };

  // update فقط اگر ردیف pending باشد اثر می‌کند (مدلِ WHERE status='pending' در reject؛
  // در approve هم ردیف در لحظه‌ی update هنوز pending است).
  const update = () => ({
    set: (s: Row) => ({
      where: () => ({
        returning: () => {
          if (state.row && state.row.status === "pending") {
            state.row = { ...state.row, ...s };
            return Promise.resolve([state.row]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  });

  const tx = { select, update };
  const db = {
    insert: () => ({
      values: (v: Row) => ({
        returning: () =>
          Promise.resolve([{ id: "pr-1", status: "pending", targetPlan: null, referenceCode: null, ...v }]),
      }),
    }),
    select,
    update,
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { db, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  creditMock.mockResolvedValue({ balanceToman: 100_000, ledgerId: "l-1" });
  grantMock.mockResolvedValue({ granted: true } as never);
});

describe("payments — کارت‌به‌کارت", () => {
  it("createPaymentRequest → ردیفِ pending می‌سازد (بدونِ credit)", async () => {
    const { db } = makeDb(null);
    const r = await createPaymentRequest(
      "u1",
      { kind: "topup", amountToman: 50_000, referenceCode: "123" },
      db as never,
    );
    expect(r.status).toBe("pending");
    expect(r.amountToman).toBe(50_000);
    expect(creditMock).not.toHaveBeenCalled();
  });

  it("approve(topup) → credit(topup) صدا می‌شود و وضعیت approved", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "topup",
      amountToman: 50_000,
      status: "pending",
      targetPlan: null,
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never);
    expect(res.status).toBe("approved");
    expect(creditMock).toHaveBeenCalledTimes(1);
    const [uid, kind, amount] = creditMock.mock.calls[0];
    expect(uid).toBe("u1");
    expect(kind).toBe("topup");
    expect(amount).toBe(50_000);
  });

  it("approve دوباره روی درخواستِ approved → already و بدونِ credit (ایدمپوتنت)", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "topup",
      amountToman: 50_000,
      status: "approved",
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never);
    expect(res.status).toBe("already");
    expect(creditMock).not.toHaveBeenCalled();
  });

  it("approve(plan) → بدونِ credit، گرنتِ ماهانه پس از commit اجرا می‌شود", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "plan",
      targetPlan: "pro",
      amountToman: 299_000,
      status: "pending",
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never);
    expect(res.status).toBe("approved");
    expect(creditMock).not.toHaveBeenCalled();
    expect(grantMock).toHaveBeenCalledTimes(1);
  });

  it("reject(pending) → rejected", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "topup",
      amountToman: 50_000,
      status: "pending",
    });
    const res = await rejectPaymentRequest("pr-1", "admin", "دلیل", db as never);
    expect(res.status).toBe("rejected");
    expect(creditMock).not.toHaveBeenCalled();
  });
});
