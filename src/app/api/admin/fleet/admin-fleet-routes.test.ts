/**
 * تست‌های مسیرهای ادمینِ ناوگانِ کارگر (Track A) — فقط «سیم‌کشیِ HTTP».
 *
 * استراتژی: گاردِ رازِ داخلی (guardInternal از @/lib/api/http) و هسته‌ی fleet
 * (assignNodeToUser/issueCommand) و db mock می‌شوند تا گاردِ راز (۴۰۱/۵۰۳)،
 * اعتبارسنجیِ بدنه (۴۰۰)، نگاشتِ WorkerIpLimitError (۴۰۹) و عبورِ پلن آزموده شود.
 *
 * نکته: GET /api/admin/fleet هرگز hashِ اعتبارنامه را برنمی‌گرداند (publicNode).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/http")>();
  return { ...actual, guardInternal: vi.fn() };
});
vi.mock("@/lib/fleet/assign", () => ({
  assignNodeToUser: vi.fn(),
  WorkerIpLimitError: class WorkerIpLimitError extends Error {
    readonly code = "worker_ip_limit_exceeded" as const;
    limit: number;
    assigned: number;
    constructor(args: { limit: number; assigned: number }) {
      super("limit");
      this.limit = args.limit;
      this.assigned = args.assigned;
    }
  },
}));
vi.mock("@/lib/fleet/commands", () => ({ issueCommand: vi.fn() }));

const dbState = vi.hoisted(() => ({ queues: [] as unknown[][] }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = dbState.queues.shift() ?? [];
      // builder هم زنجیره‌ای است (from/where/orderBy/limit) و هم thenable —
      // تا کوئریِ assignments که فقط با .from() خاتمه می‌یابد هم awaitable باشد.
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: () => builder,
        orderBy: () => Promise.resolve(rows),
        limit: () => Promise.resolve(rows),
        then: (resolve: (r: unknown[]) => unknown) =>
          Promise.resolve(resolve(rows)),
      };
      return builder;
    }),
  },
}));

import { guardInternal } from "@/lib/api/http";
import { assignNodeToUser, WorkerIpLimitError } from "@/lib/fleet/assign";
import { issueCommand } from "@/lib/fleet/commands";

import { GET as fleetGET } from "@/app/api/admin/fleet/route";
import { POST as assignPOST } from "@/app/api/admin/fleet/assign/route";
import { POST as commandPOST } from "@/app/api/admin/fleet/command/route";

const guardMock = vi.mocked(guardInternal);
const assignMock = vi.mocked(assignNodeToUser);
const issueMock = vi.mocked(issueCommand);

const USER_ID = "33333333-3333-4333-8333-333333333333";
const NODE_ID = "11111111-1111-4111-8111-111111111111";

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.queues = [];
  // پیش‌فرض: گارد عبور می‌دهد (null = مجاز).
  guardMock.mockReturnValue(null);
});

/* ────────────────────────────  GET /admin/fleet  ───────────────────────── */

describe("GET /api/admin/fleet", () => {
  it("بدونِ رازِ داخلی (گارد ۴۰۱) → ۴۰۱", async () => {
    guardMock.mockReturnValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    const res = await fleetGET(new Request("https://k.app/api/admin/fleet"));
    expect(res.status).toBe(401);
  });

  it("نودها را با تخصیص‌ها و بدونِ hash برمی‌گرداند", async () => {
    // صفِ اول: نودها؛ صفِ دوم: تخصیص‌ها.
    dbState.queues = [
      [
        {
          id: NODE_ID,
          nodeKey: "node-a",
          health: "online",
          credentialHash: "SECRET",
          enrollmentTokenHash: "SECRET2",
          createdAt: new Date("2026-05-01"),
          lastSeenAt: new Date("2026-06-01"),
        },
      ],
      [
        {
          id: "assign-1",
          userId: USER_ID,
          nodeId: NODE_ID,
          createdAt: new Date("2026-06-02"),
        },
      ],
    ];
    const res = await fleetGET(new Request("https://k.app/api/admin/fleet"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0].credentialHash).toBeUndefined();
    expect(body.nodes[0].enrollmentTokenHash).toBeUndefined();
    expect(body.nodes[0].assignments).toHaveLength(1);
    expect(body.nodes[0].assignments[0].userId).toBe(USER_ID);
  });
});

/* ──────────────────────────  POST /admin/fleet/assign  ─────────────────── */

describe("POST /api/admin/fleet/assign", () => {
  it("رازِ سرور تنظیم‌نشده (گارد ۵۰۳) → ۵۰۳ و assign صدا نمی‌شود", async () => {
    guardMock.mockReturnValue(Response.json({ error: "disabled" }, { status: 503 }));
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: NODE_ID,
      }),
    );
    expect(res.status).toBe(503);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("کاربرِ ناموجود → ۴۰۴", async () => {
    dbState.queues = [[]]; // user lookup خالی.
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: NODE_ID,
      }),
    );
    expect(res.status).toBe(404);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("نودِ ناموجود → ۴۰۴", async () => {
    dbState.queues = [[{ plan: "max" }], []]; // user موجود، node خالی.
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: NODE_ID,
      }),
    );
    expect(res.status).toBe(404);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("تخصیصِ موفق → ۲۰۱؛ پلنِ کاربر به هسته پاس می‌شود", async () => {
    dbState.queues = [[{ plan: "maxplus" }], [{ id: NODE_ID }]];
    assignMock.mockResolvedValue({
      id: "assign-1",
      userId: USER_ID,
      nodeId: NODE_ID,
    } as never);
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: NODE_ID,
      }),
    );
    expect(res.status).toBe(201);
    expect(assignMock).toHaveBeenCalledWith(USER_ID, NODE_ID, "maxplus");
  });

  it("سقفِ IPِ پلن پر (WorkerIpLimitError) → ۴۰۹ با limit/assigned", async () => {
    dbState.queues = [[{ plan: "max" }], [{ id: NODE_ID }]];
    assignMock.mockRejectedValue(new WorkerIpLimitError({ limit: 1, assigned: 1 }));
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: NODE_ID,
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.limit).toBe(1);
    expect(body.assigned).toBe(1);
  });

  it("nodeIdِ غیر-UUID → ۴۰۰", async () => {
    const res = await assignPOST(
      jsonReq("https://k.app/api/admin/fleet/assign", {
        userId: USER_ID,
        nodeId: "bad",
      }),
    );
    expect(res.status).toBe(400);
    expect(assignMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────  POST /admin/fleet/command  ────────────────── */

describe("POST /api/admin/fleet/command", () => {
  it("بدونِ رازِ داخلی → ۴۰۱ و issueCommand صدا نمی‌شود", async () => {
    guardMock.mockReturnValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    const res = await commandPOST(
      jsonReq("https://k.app/api/admin/fleet/command", {
        nodeId: NODE_ID,
        command: "update",
      }),
    );
    expect(res.status).toBe(401);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("نودِ ناموجود → ۴۰۴", async () => {
    dbState.queues = [[]]; // node lookup خالی.
    const res = await commandPOST(
      jsonReq("https://k.app/api/admin/fleet/command", {
        nodeId: NODE_ID,
        command: "restart",
      }),
    );
    expect(res.status).toBe(404);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("فرمانِ update → ۲۰۱ و issueCommand با command درست", async () => {
    dbState.queues = [[{ id: NODE_ID }]];
    issueMock.mockResolvedValue({
      id: "cmd-1",
      nodeId: NODE_ID,
      command: "update",
      status: "pending",
    } as never);
    const res = await commandPOST(
      jsonReq("https://k.app/api/admin/fleet/command", {
        nodeId: NODE_ID,
        command: "update",
      }),
    );
    expect(res.status).toBe(201);
    expect(issueMock).toHaveBeenCalledWith(NODE_ID, "update", {});
  });

  it("payload اختیاری به هسته پاس می‌شود", async () => {
    dbState.queues = [[{ id: NODE_ID }]];
    issueMock.mockResolvedValue({ id: "cmd-2" } as never);
    const res = await commandPOST(
      jsonReq("https://k.app/api/admin/fleet/command", {
        nodeId: NODE_ID,
        command: "update",
        payload: { targetVersion: "3.0.0" },
      }),
    );
    expect(res.status).toBe(201);
    expect(issueMock).toHaveBeenCalledWith(NODE_ID, "update", {
      payload: { targetVersion: "3.0.0" },
    });
  });

  it("commandِ نامعتبر → ۴۰۰", async () => {
    const res = await commandPOST(
      jsonReq("https://k.app/api/admin/fleet/command", {
        nodeId: NODE_ID,
        command: "shutdown",
      }),
    );
    expect(res.status).toBe(400);
    expect(issueMock).not.toHaveBeenCalled();
  });
});
