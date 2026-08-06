/**
 * تست‌های مسیرهای «اپلای خودکار» (Track A): `GET /api/auto-apply`, `PUT /api/auto-apply`.
 *
 * نشستِ وب (getCurrentUser) و هسته‌ی Foundation (getAutoApplySettings/setAutoApplyEnabled/
 * recordAutoApplyAudit) کاملاً mock می‌شوند — هیچ DB/شبکه‌ی زنده (قاعده‌ی پروژه).
 * تمرکزِ بحرانی:
 *   • بدونِ نشست → ۴۰۱ (هیچ خواندن/نوشتنی).
 *   • قاعده‌ی ۴/§۱۰: کاربر همیشه از نشست می‌آید؛ بدنه userId نمی‌پذیرد.
 *   • PUT: گذارِ تاگل (خاموش→روشن / روشن→خاموش) یک ردیفِ ممیزیِ متناظر می‌نویسد؛
 *     نبودِ گذار (فقط تغییرِ آستانه) چیزی در ممیزی نمی‌نویسد.
 *   • اعتبارسنجی: بدنه‌ی خالی/نامعتبر و minScore خارج از [۰،۱] → ۴۰۰.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUserOrBearer: vi.fn() }));
vi.mock("@/lib/apply/auto-apply", () => ({
  getAutoApplySettings: vi.fn(),
  setAutoApplyEnabled: vi.fn(),
  recordAutoApplyAudit: vi.fn(),
}));

import { getCurrentUserOrBearer } from "@/lib/auth/http";
import {
  getAutoApplySettings,
  recordAutoApplyAudit,
  setAutoApplyEnabled,
} from "@/lib/apply/auto-apply";

import { GET, PUT } from "@/app/api/auto-apply/route";

const getCurrentUserMock = vi.mocked(getCurrentUserOrBearer);
const getSettingsMock = vi.mocked(getAutoApplySettings);
const setEnabledMock = vi.mocked(setAutoApplyEnabled);
const recordAuditMock = vi.mocked(recordAutoApplyAudit);

const USER = { id: "user-1", phone: "0912", isActive: true } as never;

function putReq(body: unknown) {
  return new Request("https://k.app/api/auto-apply", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ─────────────────────────────  GET /api/auto-apply  ──────────────────────── */

describe("GET /api/auto-apply", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ خواندنی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await GET(new Request("https://karjoo.1xai.ir/api/auto-apply"));
    expect(res.status).toBe(401);
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  it("تنظیماتِ مؤثر را مقید به userIdِ نشست برمی‌گرداند", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.85 });

    const res = await GET(new Request("https://karjoo.1xai.ir/api/auto-apply"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true, minScore: 0.85 });
    // با userIdِ نشست خوانده شد (نه از کوئری/بدنه).
    expect(getSettingsMock).toHaveBeenCalledWith("user-1");
  });
});

/* ─────────────────────────────  PUT /api/auto-apply  ──────────────────────── */

describe("PUT /api/auto-apply", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ نوشتنی", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(401);
    expect(setEnabledMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی خالی → ۴۰۰ (چیزی برای تغییر نیست)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await PUT(putReq({}));
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("minScore خارج از بازه‌ی [۰،۱] → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const res = await PUT(putReq({ minScore: 1.5 }));
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });

  it("روشن‌کردن (خاموش→روشن) → تنظیم می‌شود و auto_apply_enabled ممیزی می‌گردد", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getSettingsMock.mockResolvedValue({ enabled: false, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true, minScore: 0.7 });

    // با userIdِ نشست + enabled=true صدا شد.
    expect(setEnabledMock).toHaveBeenCalledTimes(1);
    expect(setEnabledMock.mock.calls[0][0]).toBe("user-1");
    expect(setEnabledMock.mock.calls[0][1]).toBe(true);

    // ردیفِ ممیزیِ روشن‌شدن نوشته شد (و هیچ راز/نشستی در metadata نیست).
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = recordAuditMock.mock.calls[0][0];
    expect(auditArg.userId).toBe("user-1");
    expect(auditArg.eventType).toBe("auto_apply_enabled");
    // متادیتای تصمیم (آستانه + کانالِ افزونه)، هرگز نشست/راز.
    expect(auditArg.metadata).toEqual({ minScore: 0.7, channel: "extension" });
  });

  it("خاموش‌کردن (روشن→خاموش) → auto_apply_disabled ممیزی می‌گردد", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: false, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: false }));
    expect(res.status).toBe(200);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0][0].eventType).toBe("auto_apply_disabled");
  });

  it("فقط تغییرِ آستانه (بدونِ گذارِ تاگل) → هیچ ممیزی‌ای نوشته نمی‌شود", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    // حالتِ فعلی روشن است؛ بدنه فقط minScore را تغییر می‌دهد → تاگل عوض نمی‌شود.
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.9 });

    const res = await PUT(putReq({ minScore: 0.9 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ enabled: true, minScore: 0.9 });

    // enabled در غیابِ بدنه از حالتِ فعلی (true) حفظ شد، و minScore پاس شد.
    expect(setEnabledMock).toHaveBeenCalledWith("user-1", true, { minScore: 0.9 });
    // چون تاگل عوض نشد، هیچ ممیزی‌ای نوشته نمی‌شود.
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("مقدارِ تکراری (روشن→روشن) → هیچ ممیزی‌ای (idempotent برای تاگل)", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    getSettingsMock.mockResolvedValue({ enabled: true, minScore: 0.7 });
    setEnabledMock.mockResolvedValue({ enabled: true, minScore: 0.7 });

    const res = await PUT(putReq({ enabled: true }));
    expect(res.status).toBe(200);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی JSON نامعتبر → ۴۰۰", async () => {
    getCurrentUserMock.mockResolvedValue(USER);
    const req = new Request("https://k.app/api/auto-apply", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    expect(setEnabledMock).not.toHaveBeenCalled();
  });
});
