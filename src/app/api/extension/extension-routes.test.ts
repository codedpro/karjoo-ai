/**
 * تست‌های هندلرِ مسیرهای افزونه — `/api/extension/link` و `/api/extension/me`.
 *
 * هسته‌ی auth و DB کاملاً mock می‌شوند (بدون DB/شبکه‌ی زنده، قاعده‌ی پروژه). فقط
 * منطقِ مسیر تست می‌شود: احراز، fail-closed، شکلِ پاسخ، و اینکه توکنِ خام فقط در
 * پاسخِ link برمی‌گردد.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* state مشترکِ mockها — با vi.hoisted تا پیش از mock factoryها در دسترس باشد. */
const h = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  return { selectResults };
});

vi.mock("@/lib/auth/pairing", () => ({ redeemPairingCode: vi.fn() }));
vi.mock("@/lib/api/bearer-auth", () => ({ requireBearerSession: vi.fn() }));
vi.mock("@/lib/apply/boards/jobinja", () => ({
  buildSearchUrl: vi.fn(() => "https://jobinja.ir/jobs?sort=published_at_desc"),
}));
vi.mock("@/lib/apply/filters", () => ({
  readApplyFilters: vi.fn(),
  readJobPreferences: vi.fn(),
}));
vi.mock("@/lib/apply/orchestrator", () => ({
  enqueueBrowserDiscoveredListings: vi.fn(),
}));
vi.mock("@/lib/apply/extension-queue-reset", () => ({
  resetExtensionQueue: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
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

import { redeemPairingCode } from "@/lib/auth/pairing";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { readApplyFilters, readJobPreferences } from "@/lib/apply/filters";
import { HttpError } from "@/lib/api/http";
import { GET as discoveryGET } from "@/app/api/extension/discovery/route";
import { POST as linkPOST } from "@/app/api/extension/link/route";
import { GET as meGET } from "@/app/api/extension/me/route";
import { POST as resetQueuePOST } from "@/app/api/extension/queue/reset/route";
import { resetExtensionQueue } from "@/lib/apply/extension-queue-reset";

const redeemMock = vi.mocked(redeemPairingCode);
const authMock = vi.mocked(requireBearerSession);
const readApplyFiltersMock = vi.mocked(readApplyFilters);
const readJobPreferencesMock = vi.mocked(readJobPreferences);
const resetQueueMock = vi.mocked(resetExtensionQueue);

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

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

describe("POST /api/extension/link", () => {
  it("کدِ معتبر → ۲۰۱ با توکنِ خام در بدنه", async () => {
    redeemMock.mockResolvedValue({
      session: {
        token: "raw-extension-token",
        sessionRow: {
          kind: "extension",
          userId: "user-9",
          expiresAt: new Date("2030-01-01"),
        },
      },
      link: {},
    } as never);

    const res = await linkPOST(
      jsonReq("https://k.app/api/extension/link", { pairingCode: "PAIR-1" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("raw-extension-token");
    expect(body.kind).toBe("extension");
    expect(body.userId).toBe("user-9");
  });

  it("کدِ نامعتبر/منقضی → ۴۰۱ بدونِ توکن", async () => {
    redeemMock.mockResolvedValue(null);
    const res = await linkPOST(
      jsonReq("https://k.app/api/extension/link", { pairingCode: "BAD" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.token).toBeUndefined();
  });

  it("بدنه‌ی نامعتبر (بدونِ pairingCode) → ۴۰۰", async () => {
    const res = await linkPOST(jsonReq("https://k.app/api/extension/link", {}));
    expect(res.status).toBe(400);
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it("فیلدِ اضافی (مثلِ token) → ۴۰۰ (strict)", async () => {
    const res = await linkPOST(
      jsonReq("https://k.app/api/extension/link", {
        pairingCode: "X",
        token: "inject",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/extension/me", () => {
  function getReq() {
    return new Request("https://k.app/api/extension/me", {
      headers: { authorization: "Bearer t" },
    });
  }

  it("نشستِ افزونه → کاربر + سایت‌های متصل", async () => {
    authMock.mockResolvedValue({
      userId: "user-3",
      session: { kind: "extension" },
    } as never);
    pushSelect([
      { id: "user-3", email: "ali@example.com", name: "Ali", avatarUrl: null, fullName: "Ali", isActive: true },
    ]);
    pushSelect([
      { board: "jobinja", status: "connected", accountLabel: "me", lastConnectedAt: null },
    ]);

    const res = await meGET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe("user-3");
    expect(body.boards).toHaveLength(1);
    expect(body.boards[0].board).toBe("jobinja");
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
  });

  it("نشستِ نامعتبر → ۴۰۱ (از نگهبان)", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await meGET(getReq());
    expect(res.status).toBe(401);
  });

  it("کاربرِ حذف‌شده ولی نشستِ معتبر → ۴۰۴", async () => {
    authMock.mockResolvedValue({
      userId: "ghost",
      session: { kind: "extension" },
    } as never);
    pushSelect([]); // users خالی
    const res = await meGET(getReq());
    expect(res.status).toBe(404);
  });
});

describe("GET /api/extension/discovery", () => {
  function getReq() {
    return new Request("https://k.app/api/extension/discovery", {
      headers: { authorization: "Bearer t" },
    });
  }

  it("returns every active discovery provider, including karboom", async () => {
    authMock.mockResolvedValue({
      userId: "user-3",
      session: { kind: "extension" },
    } as never);
    readJobPreferencesMock.mockResolvedValue({
      categorySlugs: ["وب،‌-برنامه‌نویسی-و-نرم‌افزار"],
      remoteOnly: true,
    } as never);
    const board = {
      enabled: true,
      categoryKeys: ["software"],
      cities: [],
      employmentTypeKeys: [],
      remoteOnly: true,
    };
    readApplyFiltersMock.mockResolvedValue({
      paused: false,
      maxAgeDays: 45,
      boardFilters: {
        jobinja: board,
        jobvision: board,
        "e-estekhdam": board,
        irantalent: board,
        karboom: { ...board, cities: ["تهران"] },
      },
    } as never);

    const res = await discoveryGET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.boards.map((item: { board: string }) => item.board)).toEqual([
      "jobinja",
      "jobvision",
      "e-estekhdam",
      "irantalent",
      "karboom",
    ]);
    expect(body.boards.at(-1)).toMatchObject({
      board: "karboom",
      enabled: true,
      hasTargeting: true,
      cities: ["تهران"],
    });
  });
});

describe("POST /api/extension/queue/reset", () => {
  const executorId = "11111111-1111-4111-8111-111111111111";

  it("resets only the authenticated extension user's queue", async () => {
    authMock.mockResolvedValue({ userId: "user-3", session: { kind: "extension" } } as never);
    resetQueueMock.mockResolvedValue({ removed: 9, byBoard: { jobinja: 9 } });

    const res = await resetQueuePOST(jsonReq("https://k.app/api/extension/queue/reset", { executorId }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 9, byBoard: { jobinja: 9 } });
    expect(authMock).toHaveBeenCalledWith(expect.anything(), { requireKind: "extension" });
    expect(resetQueueMock).toHaveBeenCalledWith("user-3", executorId);
  });

  it("rejects a malformed executor id before reset", async () => {
    authMock.mockResolvedValue({ userId: "user-3", session: { kind: "extension" } } as never);

    const res = await resetQueuePOST(jsonReq("https://k.app/api/extension/queue/reset", {
      executorId: "not-a-browser-id",
    }));

    expect(res.status).toBe(400);
    expect(resetQueueMock).not.toHaveBeenCalled();
  });
});
