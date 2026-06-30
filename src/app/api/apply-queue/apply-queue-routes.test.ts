/**
 * تست‌های هندلرِ `/api/apply-queue/claim` و `/api/apply-queue/:id/result`.
 *
 * نگهبانِ Bearer و توابعِ صفِ افزونه (claimUserApplyItems/recordResult) mock می‌شوند.
 * تمرکز: احراز با نشستِ افزونه، مقیدبودن به همان کاربر (قاعده‌ی ۴)، و اینکه نتیجه
 * فقط با گزارشِ صریحِ افزونه ثبت می‌شود (قاعده‌ی ۲).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/bearer-auth", () => ({ requireBearerSession: vi.fn() }));
vi.mock("@/lib/apply/extension-queue", () => ({
  claimUserApplyItems: vi.fn(),
  recordResult: vi.fn(),
}));
// گاردِ سهمیه‌ی اپلای (Track B) را mock می‌کنیم تا تستِ روت بدونِ DB اجرا شود؛ پیش‌فرض
// «عبور» (سهمیه آزاد) است تا تست‌های موجود دست‌نخورده بمانند.
vi.mock("@/lib/billing/apply-quota-guard", () => ({
  assertApplyQuotaForUser: vi.fn(),
}));

import { requireBearerSession } from "@/lib/api/bearer-auth";
import { claimUserApplyItems, recordResult } from "@/lib/apply/extension-queue";
import { assertApplyQuotaForUser } from "@/lib/billing/apply-quota-guard";
import { ApplyQuotaError } from "@/lib/billing/errors";
import { HttpError } from "@/lib/api/http";
import { POST as claimPOST } from "@/app/api/apply-queue/claim/route";
import { POST as resultPOST } from "@/app/api/apply-queue/[id]/result/route";

const authMock = vi.mocked(requireBearerSession);
const claimMock = vi.mocked(claimUserApplyItems);
const recordMock = vi.mocked(recordResult);
const quotaMock = vi.mocked(assertApplyQuotaForUser);

beforeEach(() => {
  vi.clearAllMocks();
});

const VALID_ID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/apply-queue/claim", () => {
  function claimReq(body?: unknown) {
    const init: RequestInit = {
      method: "POST",
      headers: { authorization: "Bearer t" },
    };
    if (body !== undefined) {
      init.headers = { ...(init.headers as object), "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    return new Request("https://k.app/api/apply-queue/claim", init);
  }

  it("نشستِ افزونه → آیتم‌های همین کاربر (limit پیش‌فرض)", async () => {
    authMock.mockResolvedValue({
      userId: "user-5",
      session: { kind: "extension" },
    } as never);
    claimMock.mockResolvedValue([
      { taskId: "t1", matchId: "m1", listing: { title: "Dev" } },
    ] as never);

    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.items[0].taskId).toBe("t1");
    expect(claimMock).toHaveBeenCalledWith("user-5", 5);
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
  });

  it("بدنه‌ی خالی هم مجاز است (پیش‌فرض)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([] as never);
    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    expect(claimMock).toHaveBeenCalledWith("u", 5);
  });

  it("limit سفارشی رعایت می‌شود", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([] as never);
    await claimPOST(claimReq({ limit: 3 }));
    expect(claimMock).toHaveBeenCalledWith("u", 3);
  });

  it("limit نامعتبر → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await claimPOST(claimReq({ limit: 999 }));
    expect(res.status).toBe(400);
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("نشستِ نامعتبر → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await claimPOST(claimReq());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/apply-queue/:id/result — قاعده‌ی ۲ (تأییدِ صریح)", () => {
  function resultReq(body: unknown) {
    return new Request(`https://k.app/api/apply-queue/${VALID_ID}/result`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify(body),
    });
  }
  const params = () => Promise.resolve({ id: VALID_ID });

  it("گزارشِ submitted → ثبتِ application با channel=extension", async () => {
    authMock.mockResolvedValue({
      userId: "user-8",
      session: { kind: "extension" },
    } as never);
    recordMock.mockResolvedValue({
      application: { id: "app-1", status: "submitted", channel: "extension" },
      taskStatus: "succeeded",
    } as never);

    const res = await resultPOST(resultReq({ status: "submitted", externalRef: "ref" }), {
      params: params(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.application.channel).toBe("extension");
    expect(body.taskStatus).toBe("succeeded");
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: VALID_ID, userId: "user-8", status: "submitted" }),
    );
  });

  it("taskِ متعلق به کاربرِ دیگر/ناموجود → ۴۰۴", async () => {
    authMock.mockResolvedValue({
      userId: "user-8",
      session: { kind: "extension" },
    } as never);
    recordMock.mockResolvedValue(null);
    const res = await resultPOST(resultReq({ status: "submitted" }), {
      params: params(),
    });
    expect(res.status).toBe(404);
  });

  it("idِ غیرUUID → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await resultPOST(resultReq({ status: "submitted" }), {
      params: Promise.resolve({ id: "bad" }),
    });
    expect(res.status).toBe(400);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("statusِ نامعتبر → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await resultPOST(resultReq({ status: "queued" }), { params: params() });
    expect(res.status).toBe(400);
  });

  it("نشستِ نامعتبر → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await resultPOST(resultReq({ status: "submitted" }), {
      params: params(),
    });
    expect(res.status).toBe(401);
  });

  it("سقفِ اپلای روزانه (submitted) → ۴۲۹ + code=apply_quota_exceeded، بدونِ ثبت", async () => {
    authMock.mockResolvedValue({
      userId: "user-free",
      session: { kind: "extension" },
    } as never);
    // گارد سقف را رد می‌کند (کاربرِ free به ۱۰۰/روز رسیده).
    quotaMock.mockRejectedValue(new ApplyQuotaError({ usedToday: 100, limit: 100 }));

    const res = await resultPOST(resultReq({ status: "submitted" }), {
      params: params(),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("apply_quota_exceeded");
    expect(body.limit).toBe(100);
    expect(body.usedToday).toBe(100);
    // مهم: وقتی سقف پر است، اپلای ثبت نمی‌شود (recordResult صدا زده نمی‌شود).
    expect(recordMock).not.toHaveBeenCalled();
    // گارد با همان userIdِ نشست صدا زده شده (قاعده‌ی ۴).
    expect(quotaMock).toHaveBeenCalledWith("user-free");
  });

  it("گزارشِ skipped → گاردِ سهمیه صدا زده نمی‌شود (فقط submitted سهمیه می‌سوزاند)", async () => {
    authMock.mockResolvedValue({
      userId: "user-9",
      session: { kind: "extension" },
    } as never);
    recordMock.mockResolvedValue({
      application: { id: "app-2", status: "skipped", channel: "extension" },
      taskStatus: "succeeded",
    } as never);

    const res = await resultPOST(resultReq({ status: "skipped", reason: "off-topic" }), {
      params: params(),
    });
    expect(res.status).toBe(200);
    expect(quotaMock).not.toHaveBeenCalled();
    expect(recordMock).toHaveBeenCalled();
  });

  it("submitted در سهمیه → گارد عبور می‌کند و اپلای ثبت می‌شود", async () => {
    authMock.mockResolvedValue({
      userId: "user-ok",
      session: { kind: "extension" },
    } as never);
    quotaMock.mockResolvedValue({ limit: 100, usedToday: 3, remaining: 97 });
    recordMock.mockResolvedValue({
      application: { id: "app-3", status: "submitted", channel: "extension" },
      taskStatus: "succeeded",
    } as never);

    const res = await resultPOST(resultReq({ status: "submitted" }), {
      params: params(),
    });
    expect(res.status).toBe(200);
    expect(quotaMock).toHaveBeenCalledWith("user-ok");
    expect(recordMock).toHaveBeenCalled();
  });
});
