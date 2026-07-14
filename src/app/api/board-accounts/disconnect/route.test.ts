/**
 * تست‌های هندلرِ DELETE /api/board-accounts/disconnect (قطعِ اتصالِ سایت).
 *
 * تضمین‌های بحرانی (Area 4):
 *   • user-scoping: کاربر از نشست (getCurrentUser) می‌آید، نه از بدنه؛ کوئری به همان
 *     کاربر مقید است. حسابِ کاربرِ دیگر/ناموجود → ۴۰۴ (بدونِ فاشِ وجود).
 *   • vault-delete: قطعِ اتصالِ موفق **حتماً** بلابِ session_blobs را حذف می‌کند و وضعیت را
 *     به needs_reauth برمی‌گرداند — هر دو در یک تراکنش.
 *   • idempotency: قطعِ اتصالِ حسابی که رکورد دارد باز هم ۲۰۰ می‌دهد (نه ۵۰۰).
 *
 * auth و DB کاملاً mock می‌شوند (بدونِ نشست/DBِ واقعی).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** صف‌های نتیجه‌ی SELECTِ درونِ تراکنش (به‌ترتیبِ فراخوانی). */
  selectRows: [] as unknown[][],
  /** whereهای delete(session_blobs) — طولش = تعدادِ حذف‌های خزانه. */
  deleteCalls: [] as unknown[],
  /** آرگومان‌های .set() آپدیتِ board_accounts. */
  updateSets: [] as Record<string, unknown>[],
  /** مقادیرِ insertِ audit_events. */
  insertValues: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db", () => {
  const makeTx = () => ({
    select: vi.fn(() => {
      const rows = h.selectRows.shift() ?? [];
      const b: Record<string, unknown> = {
        from: () => b,
        where: () => b,
        limit: () => Promise.resolve(rows),
      };
      return b;
    }),
    delete: vi.fn(() => ({
      where: (w: unknown) => {
        h.deleteCalls.push(w ?? "called");
        return Promise.resolve(undefined);
      },
    })),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        h.updateSets.push(s);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
  });
  return {
    db: {
      transaction: vi.fn((cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
        Promise.resolve(cb(makeTx())),
      ),
      insert: vi.fn(() => ({
        values: (v: Record<string, unknown>) => {
          h.insertValues.push(v);
          return Promise.resolve(undefined);
        },
      })),
    },
  };
});

import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth/http";
import { DELETE as disconnectDELETE } from "@/app/api/board-accounts/disconnect/route";

const userMock = vi.mocked(getCurrentUser);
const txMock = vi.mocked(db.transaction);

function disconnectReq(body: unknown) {
  return new Request("https://k.app/api/board-accounts/disconnect", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectRows.length = 0;
  h.deleteCalls.length = 0;
  h.updateSets.length = 0;
  h.insertValues.length = 0;
});

describe("DELETE /api/board-accounts/disconnect", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ تراکنشی", async () => {
    userMock.mockResolvedValue(null);
    const res = await disconnectDELETE(disconnectReq({ board: "jobinja" }));
    expect(res.status).toBe(401);
    expect(txMock).not.toHaveBeenCalled();
  });

  it("حسابِ متصلِ کاربر → حذفِ بلابِ خزانه + وضعیت needs_reauth + ۲۰۰", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    h.selectRows.push([{ id: "ba-1" }]); // حسابِ متعلق به همین کاربر

    const res = await disconnectDELETE(disconnectReq({ board: "jobinja" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("needs_reauth");

    // vault-delete: دقیقاً یک‌بار بلابِ خزانه حذف شد.
    expect(h.deleteCalls).toHaveLength(1);
    // وضعیت به needs_reauth برگشت.
    expect(h.updateSets).toHaveLength(1);
    expect(h.updateSets[0].status).toBe("needs_reauth");
    // یک ردیفِ ممیزی نوشته شد و هیچ مادهٔ سری در آن نیست.
    expect(h.insertValues).toHaveLength(1);
    expect(h.insertValues[0].userId).toBe("user-1");
    expect(JSON.stringify(h.insertValues[0])).not.toMatch(/ciphertext|token|cookie/i);
  });

  it("حساب متعلق به این کاربر نیست/ناموجود → ۴۰۴ و هیچ حذف/به‌روزرسانی (user-scoping)", async () => {
    userMock.mockResolvedValue({ id: "user-2" } as never);
    h.selectRows.push([]); // کوئریِ مقید به user-2 چیزی برنمی‌گرداند

    const res = await disconnectDELETE(disconnectReq({ board: "jobinja" }));
    expect(res.status).toBe(404);
    expect(h.deleteCalls).toHaveLength(0);
    expect(h.updateSets).toHaveLength(0);
    expect(h.insertValues).toHaveLength(0);
  });

  it("idempotent: قطعِ اتصالِ حسابی که رکورد دارد باز هم ۲۰۰ (نه ۵۰۰)", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    h.selectRows.push([{ id: "ba-1" }]);
    const res = await disconnectDELETE(disconnectReq({ board: "jobinja" }));
    expect(res.status).toBe(200);
  });

  it("سایتِ ناشناخته در بدنه → ۴۰۰ و هیچ تراکنشی", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    const res = await disconnectDELETE(disconnectReq({ board: "monster" }));
    expect(res.status).toBe(400);
    expect(txMock).not.toHaveBeenCalled();
  });
});
