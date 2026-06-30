/**
 * تست‌های مسیرهای خزانه‌ی نشست (Track C — قاعده‌ی ۴، §۱۰ Max/Max+):
 *   • POST /api/session/refresh  — رمز و upsert نشستِ خودِ کاربر؛ fail-closed بدونِ کلید.
 *   • GET  /api/session/status   — وضعیتِ هر سایت بدونِ هیچ مادهٔ سری.
 *
 * بزرگ‌ترین تضمین‌ها:
 *   1) round-trip: بدنه‌ی معتبر → encryptSession صدا زده و خروجیِ رمزشده به store می‌رود؛
 *      پاسخ ۲۰۰ با متادیتا (نه ciphertext).
 *   2) no-plaintext-persistence: store *هرگز* plaintext دریافت نمی‌کند — فقط
 *      {ciphertext, iv, keyVersion}؛ و هیچ ستونِ سری در پاسخ نیست.
 *   3) session-bound (قاعده‌ی ۴): userId از نشست می‌آید نه از بدنه؛ store با همان userId
 *      صدا زده می‌شود؛ board متصل‌نشده → ۴۰۹ (نمی‌توان به‌جای کسِ دیگر نوشت).
 *   4) vault-not-configured: کلید نباشد → ۵۰۳ و *هیچ* رمز/ذخیره‌ای رخ نمی‌دهد.
 *
 * crypto + store کاملاً mock می‌شوند (بدونِ DB/کلیدِ واقعی).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  /** صف‌های نتیجه‌ی SELECT برای status route (به‌ترتیبِ فراخوانی). */
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/lib/api/bearer-auth", () => ({ requireBearerSession: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectResults.shift() ?? [];
      const builder: Record<string, unknown> = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => Promise.resolve(rows),
        // SELECTِ board accounts با where خاتمه می‌یابد (بدونِ limit) → thenable.
        then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
      };
      return builder;
    }),
  },
}));
vi.mock("@/lib/vault/crypto", () => {
  class VaultNotConfiguredError extends Error {
    readonly code = "vault_not_configured" as const;
  }
  return {
    isVaultReady: vi.fn(() => true),
    encryptSession: vi.fn(() => ({ ciphertext: "CT", iv: "IV", keyVersion: 1 })),
    VaultNotConfiguredError,
  };
});
vi.mock("@/lib/vault/store", () => {
  class BoardAccountNotFoundError extends Error {
    readonly code = "board_account_not_found" as const;
  }
  return {
    upsertSessionBlob: vi.fn(),
    BoardAccountNotFoundError,
  };
});

import { requireBearerSession } from "@/lib/api/bearer-auth";
import { HttpError } from "@/lib/api/http";
import {
  encryptSession,
  isVaultReady,
  VaultNotConfiguredError,
} from "@/lib/vault/crypto";
import {
  BoardAccountNotFoundError,
  upsertSessionBlob,
} from "@/lib/vault/store";
import { POST as refreshPOST } from "@/app/api/session/refresh/route";
import { GET as statusGET } from "@/app/api/session/status/route";

const authMock = vi.mocked(requireBearerSession);
const isVaultReadyMock = vi.mocked(isVaultReady);
const encryptMock = vi.mocked(encryptSession);
const upsertMock = vi.mocked(upsertSessionBlob);

function refreshReq(body: unknown) {
  return new Request("https://k.app/api/session/refresh", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

const VALID_SESSION = {
  cookies: [{ name: "JSESSIONID", value: "abc", domain: "jobinja.ir" }],
  localStorage: { token: "jwt-123" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
  isVaultReadyMock.mockReturnValue(true);
  encryptMock.mockReturnValue({ ciphertext: "CT", iv: "IV", keyVersion: 1 });
  upsertMock.mockResolvedValue({
    id: "blob-1",
    boardAccountId: "ba-1",
    ciphertext: "CT",
    iv: "IV",
    keyVersion: 1,
    sessionShape: "cookie",
    lastRefreshed: new Date("2026-06-30T10:00:00Z"),
    expiresAt: new Date("2026-07-07T10:00:00Z"),
    createdAt: new Date("2026-06-30T10:00:00Z"),
  } as never);
});

describe("POST /api/session/refresh — round-trip و no-plaintext", () => {
  it("بدنه‌ی معتبر → رمز و upsert؛ ۲۰۰ با متادیتا (نه ciphertext)", async () => {
    authMock.mockResolvedValue({
      userId: "user-1",
      session: { kind: "extension" },
    } as never);

    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // پاسخ فقط متادیتا — هیچ مادهٔ سری نشت نمی‌کند.
    expect(body.board).toBe("jobinja");
    expect(body.lastRefreshed).toBeDefined();
    expect(body.expiresAt).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("CT"); // ciphertext لو نمی‌رود
    expect(JSON.stringify(body)).not.toContain("IV");
    expect(JSON.stringify(body)).not.toContain("ciphertext");

    // round-trip: encryptSession با plaintextِ سریال‌شده صدا زده شد.
    expect(encryptMock).toHaveBeenCalledTimes(1);
    const plaintextArg = encryptMock.mock.calls[0][0];
    expect(typeof plaintextArg).toBe("string");
    expect(plaintextArg).toContain("JSESSIONID");
  });

  it("no-plaintext-persistence: store فقط خروجیِ رمزشده می‌گیرد (نه نشستِ خام)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);

    await refreshPOST(refreshReq({ board: "jobinja", session: VALID_SESSION }));

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const arg = upsertMock.mock.calls[0][0];
    // فقط بلابِ رمزشده — هیچ کلیدِ نشست/کوکی/توکنِ خام.
    expect(arg.encrypted).toEqual({ ciphertext: "CT", iv: "IV", keyVersion: 1 });
    const serialized = JSON.stringify(arg);
    expect(serialized).not.toContain("JSESSIONID");
    expect(serialized).not.toContain("jwt-123");
  });

  it("jobvision بدونِ کوکی (فقط localStorage) → sessionShape='token'", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    await refreshPOST(
      refreshReq({ board: "jobvision", session: { localStorage: { jwt: "x" } } }),
    );
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.sessionShape).toBe("token");
  });
});

describe("POST /api/session/refresh — session-bound (قاعده‌ی ۴)", () => {
  it("userId از نشست می‌آید نه از بدنه؛ store با همان userId صدا زده می‌شود", async () => {
    authMock.mockResolvedValue({
      userId: "session-user",
      session: { kind: "extension" },
    } as never);

    // بدنه userId جعلی هم دارد — نباید اثری بگذارد (.strict آن را رد می‌کند → ۴۰۰).
    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION, userId: "attacker" }),
    );
    expect(res.status).toBe(400); // فیلدِ ناشناخته رد می‌شود
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("userId از نشست به store پاس می‌شود (نه از بدنه)", async () => {
    authMock.mockResolvedValue({
      userId: "session-user",
      session: { kind: "extension" },
    } as never);
    await refreshPOST(refreshReq({ board: "jobinja", session: VALID_SESSION }));
    expect(upsertMock.mock.calls[0][0].userId).toBe("session-user");
  });

  it("سایتِ متصل‌نشده → ۴۰۹ (نمی‌توان نشست را بدونِ board account ذخیره کرد)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    upsertMock.mockRejectedValue(new BoardAccountNotFoundError("jobinja"));
    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION }),
    );
    expect(res.status).toBe(409);
  });

  it("فقط نشستِ extension (requireKind) — نشستِ نامعتبر → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION }),
    );
    expect(res.status).toBe(401);
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
  });
});

describe("POST /api/session/refresh — vault-not-configured (fail-closed)", () => {
  it("کلید نباشد → ۵۰۳ و هیچ رمز/ذخیره‌ای رخ نمی‌دهد", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    isVaultReadyMock.mockReturnValue(false);

    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("vault not configured");
    expect(encryptMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("اگر encryptSession خطای VaultNotConfigured بدهد → ۵۰۳ (نه ۵۰۰)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    encryptMock.mockImplementation(() => {
      throw new VaultNotConfiguredError();
    });
    const res = await refreshPOST(
      refreshReq({ board: "jobinja", session: VALID_SESSION }),
    );
    expect(res.status).toBe(503);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/session/refresh — اعتبارسنجیِ ورودی", () => {
  it("نشستِ خالی (هیچ کوکی/localStorage/sessionStorage) → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await refreshPOST(refreshReq({ board: "jobinja", session: {} }));
    expect(res.status).toBe(400);
    expect(encryptMock).not.toHaveBeenCalled();
  });

  it("سایتِ ناشناخته → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await refreshPOST(
      refreshReq({ board: "monster", session: VALID_SESSION }),
    );
    expect(res.status).toBe(400);
  });

  it("expiresAtِ کلاینت رعایت می‌شود (به store پاس می‌شود)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    await refreshPOST(
      refreshReq({
        board: "jobinja",
        session: VALID_SESSION,
        expiresAt: "2026-08-01T00:00:00.000Z",
      }),
    );
    const arg = upsertMock.mock.calls[0][0];
    expect(arg.expiresAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });
});

describe("GET /api/session/status — وضعیت بدونِ مادهٔ سری", () => {
  function statusReq() {
    return new Request("https://k.app/api/session/status", {
      headers: { authorization: "Bearer t" },
    });
  }

  /** صف می‌چیند: ابتدا فهرستِ حساب‌ها، سپس برای هر حساب جدیدترین بلاب (یا خالی). */
  function queue(accounts: unknown[], blobsPerAccount: unknown[][]) {
    h.selectResults.push(accounts);
    for (const b of blobsPerAccount) h.selectResults.push(b);
  }

  it("سایتِ دارای نشستِ معتبر → connected=true, stale=false (هیچ ciphertext)", async () => {
    authMock.mockResolvedValue({ userId: "u1", session: { kind: "web" } } as never);
    queue(
      [{ id: "ba-1", board: "jobinja", status: "connected" }],
      [[{ lastRefreshed: new Date("2026-06-30T09:00:00Z"), expiresAt: new Date("2030-01-01T00:00:00Z") }]],
    );

    const res = await statusGET(statusReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.boards[0].board).toBe("jobinja");
    expect(body.boards[0].connected).toBe(true);
    expect(body.boards[0].stale).toBe(false);
    // هرگز مادهٔ سری.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("iv");
    expect(serialized).not.toContain("keyVersion");
  });

  it("نشستِ منقضی → stale=true", async () => {
    authMock.mockResolvedValue({ userId: "u1", session: { kind: "web" } } as never);
    queue(
      [{ id: "ba-1", board: "jobinja", status: "connected" }],
      [[{ lastRefreshed: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2026-01-08T00:00:00Z") }]],
    );
    const res = await statusGET(statusReq());
    const body = await res.json();
    expect(body.boards[0].connected).toBe(true);
    expect(body.boards[0].stale).toBe(true);
  });

  it("سایتِ بدونِ نشست در خزانه → connected=false, stale=true", async () => {
    authMock.mockResolvedValue({ userId: "u1", session: { kind: "web" } } as never);
    queue([{ id: "ba-1", board: "jobinja", status: "connected" }], [[]]);
    const res = await statusGET(statusReq());
    const body = await res.json();
    expect(body.boards[0].connected).toBe(false);
    expect(body.boards[0].stale).toBe(true);
    expect(body.boards[0].lastRefreshed).toBeNull();
  });

  it("کاربرِ بدونِ سایتِ متصل → فهرستِ خالی", async () => {
    authMock.mockResolvedValue({ userId: "u1", session: { kind: "web" } } as never);
    queue([], []);
    const res = await statusGET(statusReq());
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.boards).toEqual([]);
  });

  it("افزونه یا وب — بدونِ requireKind (خواندنی)", async () => {
    authMock.mockResolvedValue({ userId: "u1", session: { kind: "extension" } } as never);
    queue([], []);
    await statusGET(statusReq());
    const callOpts = authMock.mock.calls[0][1];
    expect(callOpts?.requireKind).toBeUndefined();
  });
});
