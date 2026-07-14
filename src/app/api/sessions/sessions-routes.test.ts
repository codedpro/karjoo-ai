/**
 * تست‌های مسیرهای نشستِ احراز (Area 4):
 *   • GET    /api/sessions      — فهرستِ نشست‌های خودِ کاربر (بدونِ توکن) + پرچمِ current.
 *   • DELETE /api/sessions/:id  — ابطالِ یک نشستِ *متعلق به همان کاربر* (user-scoped).
 *
 * تضمین‌های بحرانی:
 *   • no-token-leak: پاسخِ GET هرگز token/tokenHash ندارد.
 *   • user-scoping + cross-user: DELETEِ نشستی که به کاربر تعلق ندارد → ۴۰۴ و revokeSession
 *     صدا زده نمی‌شود (نمی‌توان نشستِ کسِ دیگر را باطل کرد).
 *   • idempotency: ابطالِ نشستِ از پیش باطل‌شده‌ی خودِ کاربر → ۲۰۰ (نه ۵۰۰).
 *
 * auth، core و DB کاملاً mock می‌شوند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** صف‌های نتیجه‌ی SELECT (به‌ترتیبِ فراخوانی). */
  selectRows: [] as unknown[][],
  /** مقادیرِ insertِ audit_events. */
  insertValues: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/auth/http", () => ({
  getCurrentUser: vi.fn(),
  readSessionToken: vi.fn(),
}));
vi.mock("@/lib/auth/core", () => ({
  verifySessionToken: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectRows.shift() ?? [];
      const b: Record<string, unknown> = {
        from: () => b,
        where: () => b,
        orderBy: () => Promise.resolve(rows),
        limit: () => Promise.resolve(rows),
      };
      return b;
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        h.insertValues.push(v);
        return Promise.resolve(undefined);
      },
    })),
  },
}));

import { getCurrentUser, readSessionToken } from "@/lib/auth/http";
import { revokeSession, verifySessionToken } from "@/lib/auth/core";
import { GET as sessionsGET } from "@/app/api/sessions/route";
import { DELETE as sessionDELETE } from "@/app/api/sessions/[id]/route";

const userMock = vi.mocked(getCurrentUser);
const readTokenMock = vi.mocked(readSessionToken);
const verifyMock = vi.mocked(verifySessionToken);
const revokeMock = vi.mocked(revokeSession);

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

beforeEach(() => {
  vi.clearAllMocks();
  h.selectRows.length = 0;
  h.insertValues.length = 0;
});

/* ────────────────────────────  GET /api/sessions  ──────────────────────────── */

describe("GET /api/sessions", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    userMock.mockResolvedValue(null);
    const res = await sessionsGET();
    expect(res.status).toBe(401);
  });

  it("فهرستِ نشست‌های همین کاربر — بدونِ توکن، با پرچمِ current", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    readTokenMock.mockResolvedValue("tok");
    verifyMock.mockResolvedValue({ userId: "user-1", session: { id: "s-cur" } } as never);
    h.selectRows.push([
      {
        id: "s-cur",
        kind: "web",
        userAgent: "Mozilla",
        createdAt: new Date("2026-06-01"),
        lastSeen: new Date("2026-07-01"),
        expiresAt: new Date("2026-08-01"),
        revokedAt: null,
      },
      {
        id: "s-ext",
        kind: "extension",
        userAgent: null,
        createdAt: new Date("2026-06-10"),
        lastSeen: null,
        expiresAt: new Date("2026-09-01"),
        revokedAt: null,
      },
    ]);

    const res = await sessionsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.sessions[0].current).toBe(true); // s-cur == نشستِ جاری
    expect(body.sessions[1].current).toBe(false);
    // no-token-leak: هیچ توکن/هش در پاسخ نیست.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toContain("tokenHash");
  });

  it("بدونِ کوکیِ نشست → هیچ نشستی current نیست", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    readTokenMock.mockResolvedValue(null);
    h.selectRows.push([
      {
        id: "s-1",
        kind: "extension",
        userAgent: null,
        createdAt: new Date("2026-06-10"),
        lastSeen: null,
        expiresAt: new Date("2026-09-01"),
        revokedAt: null,
      },
    ]);
    const res = await sessionsGET();
    const body = await res.json();
    expect(body.sessions[0].current).toBe(false);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────  DELETE /api/sessions/:id  ─────────────────────── */

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
const req = new Request("https://k.app/api/sessions/x", { method: "DELETE" });

describe("DELETE /api/sessions/:id", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    userMock.mockResolvedValue(null);
    const res = await sessionDELETE(req, ctx(UUID));
    expect(res.status).toBe(401);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("پارامترِ غیر-UUID → ۴۰۰", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    const res = await sessionDELETE(req, ctx("not-a-uuid"));
    expect(res.status).toBe(400);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("نشستِ متعلق به کاربر → revokeSession صدا زده و ۲۰۰", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    h.selectRows.push([{ id: UUID }]); // مالکیت تأیید شد
    revokeMock.mockResolvedValue(true);

    const res = await sessionDELETE(req, ctx(UUID));
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith(UUID);
    expect(h.insertValues).toHaveLength(1); // ردِ ممیزی
  });

  it("cross-user: نشستِ کاربرِ دیگر/ناموجود → ۴۰۴ و revokeSession صدا زده نمی‌شود", async () => {
    userMock.mockResolvedValue({ id: "attacker" } as never);
    h.selectRows.push([]); // کوئریِ مقید به attacker چیزی برنمی‌گرداند

    const res = await sessionDELETE(req, ctx(UUID));
    expect(res.status).toBe(404);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("idempotent: نشستِ از پیش باطل‌شده‌ی خودِ کاربر → ۲۰۰", async () => {
    userMock.mockResolvedValue({ id: "user-1" } as never);
    h.selectRows.push([{ id: UUID }]);
    revokeMock.mockResolvedValue(false); // از پیش باطل بوده

    const res = await sessionDELETE(req, ctx(UUID));
    expect(res.status).toBe(200);
  });
});
