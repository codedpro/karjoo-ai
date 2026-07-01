/**
 * تست‌های مسیرهای «اپلای خودکارِ سرور» (Track B): GET/PUT /api/server-auto-apply.
 *
 * نشستِ وب (getCurrentUser) و هسته‌ی Foundation (getServerAutoApplySettings/
 * setServerAutoApplyEnabled/recordAutoApplyAudit) کاملاً mock می‌شوند — هیچ DB/شبکه‌ی زنده.
 * plans.ts (workerIpLimitFor/planFor) واقعی می‌ماند (خالص، بدونِ I/O).
 *
 * تمرکزِ بحرانی (سطحِ سرور، مستقل از افزونه):
 *   • بدونِ نشست → ۴۰۱ (هیچ خواندن/نوشتنی).
 *   • قاعده‌ی ۴/§۱۰: کاربر از نشست؛ بدنه userId نمی‌پذیرد.
 *   • پلن‌گِیتِ سخت: Free/Pro نمی‌توانند روشن کنند → ۴۰۳ code:'not_entitled'، بدونِ upsert/ممیزی.
 *   • Max/Max+ می‌توانند روشن/خاموش کنند؛ گذارِ تاگل server_auto_apply_* ممیزی می‌شود.
 *   • اعتبارسنجی: بدنه‌ی خالی/نامعتبر و minScore خارج از [۰،۱] → ۴۰۰.
 *   • GET: وضعیت + eligibility را برمی‌گرداند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/apply/auto-apply", () => ({
  getServerAutoApplySettings: vi.fn(),
  setServerAutoApplyEnabled: vi.fn(),
  recordAutoApplyAudit: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/http";
import {
  getServerAutoApplySettings,
  recordAutoApplyAudit,
  setServerAutoApplyEnabled,
} from "@/lib/apply/auto-apply";

import { GET, PUT } from "@/app/api/server-auto-apply/route";

const getCurrentUserMock = vi.mocked(getCurrentUser);
const getSettingsMock = vi.mocked(getServerAutoApplySettings);
const setEnabledMock = vi.mocked(setServerAutoApplyEnabled);
const recordAuditMock = vi.mocked(recordAutoApplyAudit);

/** کاربرِ mock با پلنِ دلخواه (فقط فیلدهایی که route لمس می‌کند). */
function userWithPlan(plan: string) {
  return { id: "user-1", plan, isActive: true } as never;
}

function putReq(body: unknown) {
  return new Request("https://k.app/api/server-auto-apply", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────────  GET /api/server-auto-apply  ──────────────────────── */

describe("GET /api/server-auto-apply", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ خواندنی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  it("Max → eligible=true + وضعیت + سقفِ ورکر", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.8 });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.minScore).toBe(0.8);
    expect(body.eligible).toBe(true);
    expect(body.plan).toBe("max");
    expect(body.workerIpLimit).toBe(1);
    expect(getSettingsMock).toHaveBeenCalledWith("user-1");
  });

  it("Free → eligible=false (ورکر ندارد)", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("free"));
    getSettingsMock.mockResolvedValue({ enabled: false, minScore: 0.7 });

    const res = await GET();
    const body = await res.json();
    expect(body.eligible).toBe(false);
    expect(body.plan).toBe("free");
    expect(body.workerIpLimit).toBe(0);
  });
});

/* ──────────────────────  PUT /api/server-auto-apply  ──────────────────────── */

describe("PUT /api/server-auto-apply — پلن‌گِیت + ممیزی", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ نوشتنی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(401);
    expect(setEnabledMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی خالی → ۴۰۰ (چیزی برای تغییر نیست)", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    const res = await PUT(putReq({}));
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("minScore خارج از بازه‌ی [۰،۱] → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    const res = await PUT(putReq({ minScore: 1.5 }));
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("Free می‌خواهد روشن کند → ۴۰۳ not_entitled، بدونِ upsert/ممیزی", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("free"));
    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.details.code).toBe("not_entitled");
    expect(body.details.workerIpLimit).toBe(0);
    // هیچ نوشتنی رخ نداد (fail-closed پیش از upsert).
    expect(setEnabledMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("Pro هم ورکر ندارد → روشن‌کردن ۴۰۳ not_entitled", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("pro"));
    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(403);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("Free فقط آستانه را تغییر می‌دهد → ۴۰۳ (بی‌ورکر نمی‌تواند سطحِ سرور را تنظیم کند)", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("free"));
    const res = await PUT(putReq({ minScore: 0.9 }));
    expect(res.status).toBe(403);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("Free می‌تواند خاموش کند (لغوِ رضایتِ قبلی) → مجاز", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("free"));
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: false, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: false }));
    expect(res.status).toBe(200);
    expect(setEnabledMock).toHaveBeenCalledWith("user-1", false, {});
    // گذارِ روشن→خاموش → ممیزیِ server_auto_apply_disabled.
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0][0].eventType).toBe(
      "server_auto_apply_disabled",
    );
  });

  it("Max روشن‌کردن (خاموش→روشن) → تنظیم + server_auto_apply_enabled", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    getSettingsMock.mockResolvedValue({ enabled: false, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true, minScore: 0.7 });

    expect(setEnabledMock).toHaveBeenCalledTimes(1);
    expect(setEnabledMock.mock.calls[0][0]).toBe("user-1");
    expect(setEnabledMock.mock.calls[0][1]).toBe(true);

    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = recordAuditMock.mock.calls[0][0];
    expect(auditArg.userId).toBe("user-1");
    expect(auditArg.eventType).toBe("server_auto_apply_enabled");
    expect(auditArg.metadata).toEqual({ minScore: 0.7, channel: "server" });
  });

  it("MaxPlus خاموش‌کردن (روشن→خاموش) → server_auto_apply_disabled", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("maxplus"));
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: false, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: false }));
    expect(res.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0][0].eventType).toBe(
      "server_auto_apply_disabled",
    );
  });

  it("Max فقط تغییرِ آستانه (بدونِ گذارِ تاگل) → هیچ ممیزی‌ای", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.9 });

    const res = await PUT(putReq({ minScore: 0.9 }));
    expect(res.status).toBe(200);
    // enabled در غیابِ بدنه از حالتِ فعلی (true) حفظ شد، minScore پاس شد.
    expect(setEnabledMock).toHaveBeenCalledWith("user-1", true, { minScore: 0.9 });
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("Max مقدارِ تکراری (روشن→روشن) → هیچ ممیزی‌ای (idempotent)", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(200);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی JSON نامعتبر → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(userWithPlan("max"));
    const req = new Request("https://k.app/api/server-auto-apply", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });
});
