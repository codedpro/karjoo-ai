/**
 * تست‌های هسته‌ی پرداختِ کارت‌به‌کارت (payments.ts) — *در حالِ بازنشستگی*.
 *
 * تمرکزِ بحرانی (امنیت): اعتبار/پلن *فقط* در approvePaymentRequest (تأییدِ ادمین) تغییر
 * می‌کند، تأیید ایدمپوتنت است، و رد فقط روی درخواستِ pending اثر دارد. با کیف‌پولِ
 * واحدِ 1xai: تأییدِ topupِ تاریخی به کیف‌پولِ *واحد* (creditPool، با referenceِ
 * idempotentِ karjoo:payment:<id>) واریز می‌شود — نه کیف‌پولِ محلیِ بازنشسته — و تأییدِ
 * plan فقط users.plan را ست می‌کند (هیچ گرنتِ ماهانه‌ای). وابستگی‌های pool از طریقِ
 * deps تزریق می‌شوند؛ یک fake dbِ کوچک زنجیره‌ی Drizzle + transaction را تقلید می‌کند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  approvePaymentRequest,
  createPaymentRequest,
  rejectPaymentRequest,
} from "@/lib/billing/payments";

/** موکِ واریزِ کیف‌پولِ واحد + گرهِ استخر — به‌جای mockِ ماژول، از deps تزریق می‌شوند. */
const creditPoolMock = vi.fn();
const ensureLinkMock = vi.fn();
const POOL_DEPS = { creditPoolFn: creditPoolMock, ensureLinkFn: ensureLinkMock } as never;

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
  ensureLinkMock.mockResolvedValue(72);
  creditPoolMock.mockResolvedValue({ balanceToman: 150_000, already: false });
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
    expect(creditPoolMock).not.toHaveBeenCalled();
  });

  it("approve(topup تاریخی) → creditPoolِ کیف‌پولِ *واحد* با referenceِ idempotent و وضعیت approved", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "topup",
      amountToman: 50_000,
      status: "pending",
      targetPlan: null,
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never, Date.now(), POOL_DEPS);
    expect(res.status).toBe("approved");
    // پولِ واقعیِ کاربر باید جایی برود که گیت‌ها می‌خوانند: کیف‌پولِ واحدِ 1xai.
    expect(ensureLinkMock).toHaveBeenCalledWith("u1", expect.anything());
    expect(creditPoolMock).toHaveBeenCalledTimes(1);
    expect(creditPoolMock).toHaveBeenCalledWith({
      onexaiUserId: 72,
      amountToman: 50_000,
      kind: "topup",
      reference: "karjoo:payment:pr-1",
    });
  });

  it("approve دوباره روی درخواستِ approved → already و بدونِ هیچ واریزی (ایدمپوتنت)", async () => {
    const { db } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "topup",
      amountToman: 50_000,
      status: "approved",
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never, Date.now(), POOL_DEPS);
    expect(res.status).toBe("already");
    expect(creditPoolMock).not.toHaveBeenCalled();
  });

  it("approve(plan تاریخی) → فقط ثبتِ پلن؛ نه واریزی، نه گرنتِ ماهانه (حذف شده)", async () => {
    const { db, state } = makeDb({
      id: "pr-1",
      userId: "u1",
      kind: "plan",
      targetPlan: "pro",
      amountToman: 299_000,
      status: "pending",
    });
    const res = await approvePaymentRequest("pr-1", "admin", db as never, Date.now(), POOL_DEPS);
    expect(res.status).toBe("approved");
    expect(state.row?.status).toBe("approved");
    // با کیف‌پولِ واحدِ 1xai هیچ اعتباری واریز نمی‌شود — پلن = استحقاق + قیمت.
    expect(creditPoolMock).not.toHaveBeenCalled();
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
    expect(creditPoolMock).not.toHaveBeenCalled();
  });
});
