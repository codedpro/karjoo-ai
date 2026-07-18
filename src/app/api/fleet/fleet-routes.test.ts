/**
 * تست‌های مسیرهای رو-به-نودِ ناوگانِ اپلای (Track A) — فقط «سیم‌کشیِ HTTP».
 *
 * استراتژی: هسته‌ی fleet (enroll/dispatch/commands) و نگهبانِ نود (fleet-auth) و db
 * mock می‌شوند تا احراز (۴۰۱)، اعتبارسنجیِ بدنه (۴۰۰)، نگاشتِ خطاهای typed (۵۰۳/۴۰۹) و
 * عبورِ درستِ آرگومان‌ها به هسته آزموده شود — بدونِ DB/شبکه/رمزِ واقعی.
 *
 * تضمین‌های امنیتیِ کلیدی:
 *   • nodeId همیشه از اعتبارنامه‌ی احرازشده (node.id) به هسته می‌رود — نه از بدنه.
 *   • مسیرِ claim نشست را هرگز لاگ نمی‌کند (هیچ console در مسیر نیست) و فقط به همان نود
 *     در بدنه برمی‌گرداند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/fleet-auth", () => ({ requireNodeCredential: vi.fn() }));
vi.mock("@/lib/fleet/enroll", () => ({
  enrollNode: vi.fn(),
  recordHeartbeat: vi.fn(),
  FleetEnrollmentClosedError: class FleetEnrollmentClosedError extends Error {
    readonly code = "fleet_enrollment_closed" as const;
  },
  FleetEnrollmentTokenError: class FleetEnrollmentTokenError extends Error {
    readonly code = "fleet_enrollment_token_invalid" as const;
  },
}));
vi.mock("@/lib/fleet/dispatch", () => ({
  claimFleetJobs: vi.fn(),
  recordFleetResult: vi.fn(),
}));
vi.mock("@/lib/fleet/commands", () => ({
  pollCommands: vi.fn(),
  ackCommand: vi.fn(),
}));

const dbState = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => {
      const builder: Record<string, unknown> = {
        from: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(dbState.rows),
      };
      return builder;
    }),
  },
}));

import { requireNodeCredential } from "@/lib/api/fleet-auth";
import {
  enrollNode,
  recordHeartbeat,
  FleetEnrollmentClosedError,
  FleetEnrollmentTokenError,
} from "@/lib/fleet/enroll";
import { claimFleetJobs, recordFleetResult } from "@/lib/fleet/dispatch";
import { pollCommands, ackCommand } from "@/lib/fleet/commands";
import { HttpError } from "@/lib/api/http";
import type { WorkerNode } from "@/db/schema";

import { POST as enrollPOST } from "@/app/api/fleet/enroll/route";
import { POST as heartbeatPOST } from "@/app/api/fleet/heartbeat/route";
import { POST as claimPOST } from "@/app/api/fleet/claim/route";
import { POST as resultPOST } from "@/app/api/fleet/result/route";
import { GET as commandsGET } from "@/app/api/fleet/commands/route";
import { POST as ackPOST } from "@/app/api/fleet/commands/[id]/ack/route";

const authMock = vi.mocked(requireNodeCredential);
const enrollMock = vi.mocked(enrollNode);
const heartbeatMock = vi.mocked(recordHeartbeat);
const claimMock = vi.mocked(claimFleetJobs);
const resultMock = vi.mocked(recordFleetResult);
const pollMock = vi.mocked(pollCommands);
const ackMock = vi.mocked(ackCommand);

const NODE = {
  id: "11111111-1111-4111-8111-111111111111",
  nodeKey: "node-a",
  region: "IR-residential",
  health: "online",
  capacity: 1,
  credentialHash: "SECRET_HASH",
  enrollmentTokenHash: "SECRET_ENROLL",
  agentVersion: "1.0.0",
  ipAddress: "1.2.3.4",
  lastHeartbeat: new Date("2026-06-01"),
  lastSeenAt: new Date("2026-06-01"),
  createdAt: new Date("2026-05-01"),
} satisfies WorkerNode;

const TASK_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const CMD_ID = "44444444-4444-4444-8444-444444444444";

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rows = [];
  authMock.mockResolvedValue(NODE);
});

/* ───────────────────────────────  enroll  ──────────────────────────────── */

describe("POST /api/fleet/enroll", () => {
  it("بدنه‌ی معتبر → ۲۰۱ + credential یک‌بار + نودِ بدونِ hash", async () => {
    enrollMock.mockResolvedValue({ credential: "RAW-CRED", node: NODE });
    const res = await enrollPOST(
      jsonReq("https://k.app/api/fleet/enroll", {
        enrollmentToken: "tok-secret",
        nodeKey: "node-a",
        region: "IR-residential",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.credential).toBe("RAW-CRED");
    // hashها هرگز در پاسخ نیستند.
    expect(body.node.credentialHash).toBeUndefined();
    expect(body.node.enrollmentTokenHash).toBeUndefined();
    expect(body.node.id).toBe(NODE.id);
    expect(enrollMock).toHaveBeenCalledWith("tok-secret", {
      nodeKey: "node-a",
      region: "IR-residential",
      agentVersion: null,
      ipAddress: null,
    });
  });

  it("ثبت‌نام بسته (env تنظیم‌نشده) → ۵۰۳", async () => {
    enrollMock.mockRejectedValue(new FleetEnrollmentClosedError());
    const res = await enrollPOST(
      jsonReq("https://k.app/api/fleet/enroll", {
        enrollmentToken: "x",
        nodeKey: "n",
      }),
    );
    expect(res.status).toBe(503);
  });

  it("توکنِ ثبت‌نامِ نادرست → ۴۰۱", async () => {
    enrollMock.mockRejectedValue(new FleetEnrollmentTokenError());
    const res = await enrollPOST(
      jsonReq("https://k.app/api/fleet/enroll", {
        enrollmentToken: "wrong",
        nodeKey: "n",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("بدنه‌ی بدونِ nodeKey → ۴۰۰ و enroll صدا نمی‌شود", async () => {
    const res = await enrollPOST(
      jsonReq("https://k.app/api/fleet/enroll", { enrollmentToken: "x" }),
    );
    expect(res.status).toBe(400);
    expect(enrollMock).not.toHaveBeenCalled();
  });

  it("فیلدِ ناشناخته (strict) → ۴۰۰", async () => {
    const res = await enrollPOST(
      jsonReq("https://k.app/api/fleet/enroll", {
        enrollmentToken: "x",
        nodeKey: "n",
        cookie: "should-be-rejected",
      }),
    );
    expect(res.status).toBe(400);
    expect(enrollMock).not.toHaveBeenCalled();
  });
});

/* ──────────────────────────────  heartbeat  ────────────────────────────── */

describe("POST /api/fleet/heartbeat", () => {
  it("بدونِ احراز → ۴۰۱ و heartbeat صدا نمی‌شود", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await heartbeatPOST(
      jsonReq("https://k.app/api/fleet/heartbeat", { health: "online" }),
    );
    expect(res.status).toBe(401);
    expect(heartbeatMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی معتبر → ۲۰۰ + خلاصه‌ی فرمان‌های pending؛ nodeId از اعتبارنامه", async () => {
    heartbeatMock.mockResolvedValue(NODE);
    pollMock.mockResolvedValue([
      { id: CMD_ID, command: "update" } as never,
    ]);
    const res = await heartbeatPOST(
      jsonReq("https://k.app/api/fleet/heartbeat", {
        health: "degraded",
        agentVersion: "2.0.0",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingCommands.count).toBe(1);
    expect(body.pendingCommands.commands[0]).toEqual({
      id: CMD_ID,
      command: "update",
    });
    // hashها در node نیستند.
    expect(body.node.credentialHash).toBeUndefined();
    // nodeId از NODE.id احرازشده، نه بدنه.
    expect(heartbeatMock).toHaveBeenCalledWith(NODE.id, {
      health: "degraded",
      agentVersion: "2.0.0",
    });
  });

  it("بدنه‌ی خالی مجاز است → ۲۰۰", async () => {
    heartbeatMock.mockResolvedValue(NODE);
    pollMock.mockResolvedValue([]);
    const res = await heartbeatPOST(
      new Request("https://k.app/api/fleet/heartbeat", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(heartbeatMock).toHaveBeenCalledWith(NODE.id, {});
  });

  it("healthِ نامعتبر (strict enum) → ۴۰۰", async () => {
    const res = await heartbeatPOST(
      jsonReq("https://k.app/api/fleet/heartbeat", { health: "bogus" }),
    );
    expect(res.status).toBe(400);
    expect(heartbeatMock).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────  claim  ──────────────────────────────── */

describe("POST /api/fleet/claim", () => {
  it("بدونِ احراز → ۴۰۱ و claim صدا نمی‌شود", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await claimPOST(jsonReq("https://k.app/api/fleet/claim", {}));
    expect(res.status).toBe(401);
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("کارها را با نشستِ رمزگشایی‌شده برمی‌گرداند؛ nodeId از اعتبارنامه و limit پیش‌فرض ۵", async () => {
    claimMock.mockResolvedValue([
      {
        taskId: TASK_ID,
        userId: USER_ID,
        board: "jobinja",
        listingUrl: "https://jobinja.ir/j/1",
        coverLetter: "سلام",
        resumeHtml: null,
        session: "DECRYPTED-SESSION-JSON",
      },
    ]);
    const res = await claimPOST(
      new Request("https://k.app/api/fleet/claim", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.jobs[0].session).toBe("DECRYPTED-SESSION-JSON");
    // nodeId از اعتبارنامه، limit پیش‌فرض ۵.
    expect(claimMock).toHaveBeenCalledWith(NODE.id, 5);
  });

  it("limit صریح به هسته پاس می‌شود", async () => {
    claimMock.mockResolvedValue([]);
    const res = await claimPOST(
      jsonReq("https://k.app/api/fleet/claim", { limit: 3 }),
    );
    expect(res.status).toBe(200);
    expect(claimMock).toHaveBeenCalledWith(NODE.id, 3);
  });

  it("limitِ خارج از بازه → ۴۰۰", async () => {
    const res = await claimPOST(
      jsonReq("https://k.app/api/fleet/claim", { limit: 999 }),
    );
    expect(res.status).toBe(400);
    expect(claimMock).not.toHaveBeenCalled();
  });
});

/* ───────────────────────────────  result  ──────────────────────────────── */

describe("POST /api/fleet/result", () => {
  it("بدونِ احراز → ۴۰۱ و recordFleetResult صدا نمی‌شود", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await resultPOST(
      jsonReq("https://k.app/api/fleet/result", {
        taskId: TASK_ID,
        userId: USER_ID,
        status: "submitted",
      }),
    );
    expect(res.status).toBe(401);
    expect(resultMock).not.toHaveBeenCalled();
  });

  it("نتیجه‌ی معتبر → ۲۰۰؛ nodeId از اعتبارنامه", async () => {
    resultMock.mockResolvedValue({
      application: { id: "app-1", channel: "worker" } as never,
      taskStatus: "succeeded",
    });
    const res = await resultPOST(
      jsonReq("https://k.app/api/fleet/result", {
        taskId: TASK_ID,
        userId: USER_ID,
        status: "submitted",
        externalRef: "ext-99",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskStatus).toBe("succeeded");
    expect(resultMock).toHaveBeenCalledWith(NODE.id, {
      taskId: TASK_ID,
      userId: USER_ID,
      status: "submitted",
      externalRef: "ext-99",
    });
  });

  it("task متعلق به کاربر نیست (هسته null) → ۴۰۹", async () => {
    resultMock.mockResolvedValue(null);
    const res = await resultPOST(
      jsonReq("https://k.app/api/fleet/result", {
        taskId: TASK_ID,
        userId: USER_ID,
        status: "failed",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("statusِ نامعتبر → ۴۰۰", async () => {
    const res = await resultPOST(
      jsonReq("https://k.app/api/fleet/result", {
        taskId: TASK_ID,
        userId: USER_ID,
        status: "weird",
      }),
    );
    expect(res.status).toBe(400);
    expect(resultMock).not.toHaveBeenCalled();
  });

  it("taskIdِ غیر-UUID → ۴۰۰", async () => {
    const res = await resultPOST(
      jsonReq("https://k.app/api/fleet/result", {
        taskId: "not-uuid",
        userId: USER_ID,
        status: "submitted",
      }),
    );
    expect(res.status).toBe(400);
  });
});

/* ──────────────────────────────  commands GET  ─────────────────────────── */

describe("GET /api/fleet/commands", () => {
  it("بدونِ احراز → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await commandsGET(
      new Request("https://k.app/api/fleet/commands"),
    );
    expect(res.status).toBe(401);
    expect(pollMock).not.toHaveBeenCalled();
  });

  it("فرمان‌های pendingِ همین نود را برمی‌گرداند؛ nodeId از اعتبارنامه", async () => {
    pollMock.mockResolvedValue([
      {
        id: CMD_ID,
        command: "update",
        payload: { updateScript: "./update.sh" },
        issuedAt: new Date("2026-06-10"),
        status: "pending",
      } as never,
    ]);
    const res = await commandsGET(
      new Request("https://k.app/api/fleet/commands"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.commands[0].command).toBe("update");
    expect(pollMock).toHaveBeenCalledWith(NODE.id);
  });
});

/* ───────────────────────────  commands ack POST  ───────────────────────── */

describe("POST /api/fleet/commands/:id/ack", () => {
  const params = Promise.resolve({ id: CMD_ID });

  it("بدونِ احراز → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await ackPOST(
      jsonReq(`https://k.app/api/fleet/commands/${CMD_ID}/ack`, {
        status: "acked",
      }),
      { params },
    );
    expect(res.status).toBe(401);
    expect(ackMock).not.toHaveBeenCalled();
  });

  it("فرمانِ متعلق به نودِ دیگر (مالکیت ندارد) → ۴۰۴ و ack صدا نمی‌شود", async () => {
    dbState.rows = []; // ownership check خالی برمی‌گرداند.
    const res = await ackPOST(
      jsonReq(`https://k.app/api/fleet/commands/${CMD_ID}/ack`, {
        status: "done",
        result: { exitCode: 0 },
      }),
      { params },
    );
    expect(res.status).toBe(404);
    expect(ackMock).not.toHaveBeenCalled();
  });

  it("فرمانِ متعلق به همین نود → ack صدا می‌شود و ۲۰۰", async () => {
    dbState.rows = [{ id: CMD_ID }]; // مالکیت تأیید.
    ackMock.mockResolvedValue({
      id: CMD_ID,
      status: "done",
    } as never);
    const res = await ackPOST(
      jsonReq(`https://k.app/api/fleet/commands/${CMD_ID}/ack`, {
        status: "done",
        result: { exitCode: 0 },
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(ackMock).toHaveBeenCalledWith(CMD_ID, "done", { exitCode: 0 });
  });

  it("statusِ نامعتبر → ۴۰۰", async () => {
    dbState.rows = [{ id: CMD_ID }];
    const res = await ackPOST(
      jsonReq(`https://k.app/api/fleet/commands/${CMD_ID}/ack`, {
        status: "running",
      }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(ackMock).not.toHaveBeenCalled();
  });

  it("idِ غیر-UUID → ۴۰۰", async () => {
    const res = await ackPOST(
      jsonReq("https://k.app/api/fleet/commands/bad/ack", { status: "acked" }),
      { params: Promise.resolve({ id: "bad" }) },
    );
    expect(res.status).toBe(400);
  });
});
