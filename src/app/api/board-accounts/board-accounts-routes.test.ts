/**
 * تست‌های هندلرِ `/api/board-accounts` و `/api/board-accounts/connect`.
 *
 * نگهبانِ Bearer و DB کاملاً mock می‌شوند. تمرکزِ بحرانی: قاعده‌ی ایمنیِ ۱ — connect
 * فقط متادیتا می‌پذیرد؛ هر فیلدِ سری → ۴۰۰، و هیچ مادهٔ سری به DB نمی‌رود.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const insertValues = vi.fn();
  const selectResults: unknown[][] = [];
  return { insertValues, selectResults };
});

vi.mock("@/lib/api/bearer-auth", () => ({ requireBearerSession: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        h.insertValues(v);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    })),
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder = {
        from: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(rows),
        then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
      };
      return builder;
    }),
  },
}));

import { db } from "@/db";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { HttpError } from "@/lib/api/http";
import { GET as listGET } from "@/app/api/board-accounts/route";
import { POST as connectPOST } from "@/app/api/board-accounts/connect/route";

const authMock = vi.mocked(requireBearerSession);
const dbInsert = vi.mocked(db.insert);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function connectReq(body: unknown) {
  return new Request("https://k.app/api/board-accounts/connect", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

describe("POST /api/board-accounts/connect — قاعده‌ی ایمنیِ ۱", () => {
  it("متادیتای معتبر → upsert و پاسخِ ۲۰۰ (فقط متادیتا)", async () => {
    authMock.mockResolvedValue({
      userId: "user-1",
      session: { kind: "extension" },
    } as never);
    pushSelect([
      {
        board: "jobinja",
        status: "connected",
        accountLabel: "me",
        lastConnectedAt: new Date("2026-06-30"),
      },
    ]);

    const res = await connectPOST(connectReq({ board: "jobinja", accountLabel: "me" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.board).toBe("jobinja");
    expect(body.account.status).toBe("connected");

    const inserted = h.insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.userId).toBe("user-1");
    expect(inserted.board).toBe("jobinja");
    expect(inserted.status).toBe("connected");
    expect(inserted.sessionShape).toBe("cookie");
    expect(Object.keys(inserted)).not.toContain("cookie");
    expect(Object.keys(inserted)).not.toContain("token");
  });

  it("هر چهار سایتِ فعال قابل اتصال‌اند (سرورشان داربست باشد یا نه)", async () => {
    // کانکتورِ سرورِ jobvision/e-estekhdam/irantalent داربست است، اما آداپتورِ افزونه
    // روی نشستِ خودِ کاربر کار می‌کند؛ پس اتصال باید بپذیرد وگرنه وضعیتِ ارائه‌دهنده
    // هرگز به connected نمی‌رسد.
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    for (const board of ["jobinja", "jobvision", "e-estekhdam", "irantalent"] as const) {
      dbInsert.mockClear();
      const res = await connectPOST(connectReq({ board }));
      expect(res.status).toBe(200);
      expect(dbInsert).toHaveBeenCalled();
    }
  });

  it("ایران‌تلنت با شکلِ نشستِ cookie ثبت می‌شود (توکن در کوکیِ خودِ سایت است)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    dbInsert.mockClear();
    h.insertValues.mockClear();
    const res = await connectPOST(connectReq({ board: "irantalent", accountLabel: "سارا" }));
    expect(res.status).toBe(200);
    const inserted = h.insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.board).toBe("irantalent");
    expect(inserted.sessionShape).toBe("cookie");
    expect(inserted.status).toBe("connected");
  });

  it("سایتِ واقعاً پشتیبانی‌نشده هنوز ۴۰۹ می‌گیرد", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    dbInsert.mockClear();
    const res = await connectPOST(connectReq({ board: "linkedin" }));
    expect(res.status).toBe(409);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("فیلدِ cookie در بدنه → ۴۰۰ و هیچ DB-write (مادهٔ سری رد می‌شود)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await connectPOST(
      connectReq({ board: "jobinja", cookie: "JSESSIONID=abc" }),
    );
    expect(res.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("فیلدِ token/password → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    expect(
      (await connectPOST(connectReq({ board: "jobinja", token: "JWT" }))).status,
    ).toBe(400);
    expect(
      (await connectPOST(connectReq({ board: "jobinja", password: "x" }))).status,
    ).toBe(400);
  });

  it("فقط نشستِ extension (requireKind) — نشستِ نامعتبر → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await connectPOST(connectReq({ board: "jobinja" }));
    expect(res.status).toBe(401);
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
  });
});

describe("GET /api/board-accounts", () => {
  function listReq() {
    return new Request("https://k.app/api/board-accounts", {
      headers: { authorization: "Bearer t" },
    });
  }

  it("افزونه یا وب → فهرستِ سایت‌های همین کاربر", async () => {
    authMock.mockResolvedValue({ userId: "user-2", session: { kind: "web" } } as never);
    pushSelect([
      { board: "jobinja", status: "connected", accountLabel: null },
      { board: "jobvision", status: "expired", accountLabel: "x" },
    ]);
    const res = await listGET(listReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.boards).toHaveLength(2);
    const callOpts = authMock.mock.calls[0][1];
    expect(callOpts?.requireKind).toBeUndefined();
  });
});
