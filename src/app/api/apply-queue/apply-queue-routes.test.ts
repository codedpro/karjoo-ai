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
  readUserPlan: vi.fn(),
}));
// گیتِ اپلای خودکار (قاعده‌ی ۱) — چوک‌پوینتِ claim. پیش‌فرضِ تست: «مجاز با آستانه‌ی ۰٫۷»؛
// تست‌های اختصاصیِ گیت آن را برای حالتِ خاموش/سقف override می‌کنند.
vi.mock("@/lib/apply/auto-apply", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apply/auto-apply")>(
    "@/lib/apply/auto-apply",
  );
  return { ...actual, assertAutoApplyAllowed: vi.fn() };
});
vi.mock("@/lib/apply/execution-run", () => ({
  assertExtensionExecutionOwner: vi.fn(),
  releaseStaleExtensionLeases: vi.fn(),
  ExecutionOwnershipError: class ExecutionOwnershipError extends Error { code = "execution_owner_conflict"; },
}));
vi.mock("@/lib/resume/queue-prep", () => ({
  prepareNextTailoredResumeForQueue: vi.fn(),
  prepareTailoredResumesForQueue: vi.fn(),
}));
// `after` runs post-response in Next; run it inline so the test can observe it.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => { void task(); },
}));
vi.mock("@/lib/apply/filters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/apply/filters")>("@/lib/apply/filters");
  return { ...actual, readApplyFilters: vi.fn() };
});

import { requireBearerSession } from "@/lib/api/bearer-auth";
import { claimUserApplyItems, recordResult } from "@/lib/apply/extension-queue";
import {
  assertApplyQuotaForUser,
  readUserPlan,
} from "@/lib/billing/apply-quota-guard";
import {
  assertAutoApplyAllowed,
  AutoApplyNotAllowedError,
} from "@/lib/apply/auto-apply";
import { ApplyQuotaError } from "@/lib/billing/errors";
import { assertExtensionExecutionOwner, releaseStaleExtensionLeases } from "@/lib/apply/execution-run";
import {
  prepareNextTailoredResumeForQueue,
  prepareTailoredResumesForQueue,
} from "@/lib/resume/queue-prep";
import { EMPTY_APPLY_FILTERS, readApplyFilters } from "@/lib/apply/filters";
import { HttpError } from "@/lib/api/http";
import { POST as claimPOST } from "@/app/api/apply-queue/claim/route";
import { POST as resultPOST } from "@/app/api/apply-queue/[id]/result/route";

const authMock = vi.mocked(requireBearerSession);
const claimMock = vi.mocked(claimUserApplyItems);
const recordMock = vi.mocked(recordResult);
const quotaMock = vi.mocked(assertApplyQuotaForUser);
const planMock = vi.mocked(readUserPlan);
const autoApplyMock = vi.mocked(assertAutoApplyAllowed);
const ownerMock = vi.mocked(assertExtensionExecutionOwner);
const releaseLeasesMock = vi.mocked(releaseStaleExtensionLeases);
const prepareResumeMock = vi.mocked(prepareNextTailoredResumeForQueue);
const prepareBatchMock = vi.mocked(prepareTailoredResumesForQueue);
const readFiltersMock = vi.mocked(readApplyFilters);

beforeEach(() => {
  vi.clearAllMocks();
  // پیش‌فرض‌های مسیرِ claim: پلنِ free و گیتِ اپلای خودکار «مجاز با آستانه‌ی ۰٫۷».
  planMock.mockResolvedValue("free");
  autoApplyMock.mockResolvedValue({
    minScore: 0.7,
    quota: { limit: 100, usedToday: 0, remaining: 100 },
  });
  // پیش‌فرضِ گاردِ سهمیه: «عبور». چون این فایل از clearAllMocks استفاده می‌کند (که
  // implementation را پاک نمی‌کند)، این پیش‌فرض را در هر beforeEach دوباره برقرار می‌کنیم
  // تا mockRejectedValueِ یک تست به تستِ بعدی نشت نکند.
  quotaMock.mockResolvedValue({ limit: 100, usedToday: 0, remaining: 100 });
  ownerMock.mockResolvedValue(undefined);
  releaseLeasesMock.mockResolvedValue(undefined);
  prepareResumeMock.mockResolvedValue({ status: "empty" });
  prepareBatchMock.mockResolvedValue({ attempted: 0, prepared: 0, failed: 0 });
  readFiltersMock.mockResolvedValue(EMPTY_APPLY_FILTERS);
});

const VALID_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The pre-executor claim paths never lease IranTalent: it is extension-only and
 * every task must carry a tailored PDF, which only the executor path guarantees.
 */
const LEGACY_CLAIM_BOARDS = ["jobinja", "jobvision", "e-estekhdam"];

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
    // claim با (userId, limit, undefined-db, { minScore }) صدا می‌شود (چوک‌پوینتِ گیت).
    expect(claimMock).toHaveBeenCalledWith("user-5", 5, undefined, {
      minScore: 0.7,
      allowedBoards: LEGACY_CLAIM_BOARDS,
    });
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
  });

  it("آیتمِ آماده را بی‌درنگ می‌دهد و ساختِ رزومه را به بعد از پاسخ می‌اندازد", async () => {
    // ساختِ رزومه یک فراخوانِ AI ده‌ها ثانیه‌ای است. اگر پیش از claim انجام شود،
    // افزونه برای *هر* اپلای همان‌قدر منتظر می‌ماند — همان فاصله‌ی طولانیِ بینِ ارسال‌ها.
    authMock.mockResolvedValue({ userId: "u-fast", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([
      { taskId: "t1", matchId: "m1", listing: { title: "Dev" } },
    ] as never);

    const res = await claimPOST(claimReq({ executorId: "33333333-3333-4333-8333-333333333333" }));
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);
    // هیچ ساختِ همگامی پیش از پاسخ انجام نشد.
    expect(prepareResumeMock).not.toHaveBeenCalled();
    // ولی ذخیره دوباره پر می‌شود، وگرنه claimِ بعدی دوباره منتظر می‌ماند.
    expect(prepareBatchMock).toHaveBeenCalledWith("u-fast", expect.objectContaining({
      limit: expect.any(Number),
    }));
  });

  it("اگر هیچ رزومه‌ای آماده نباشد، همان‌جا می‌سازد و دوباره claim می‌کند", async () => {
    authMock.mockResolvedValue({ userId: "u-cold", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([] as never);
    prepareResumeMock.mockResolvedValue({ status: "ready", taskId: "t9" } as never);

    const res = await claimPOST(claimReq({ executorId: "44444444-4444-4444-8444-444444444444" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 0, reason: "tailored_resume_missing" });
    expect(prepareResumeMock).toHaveBeenCalled();
    expect(claimMock).toHaveBeenCalledTimes(2);
  });

  it("executor فقط providerهای فعال را برای آماده‌سازی و claim می‌فرستد", async () => {
    authMock.mockResolvedValue({ userId: "u-executor", session: { kind: "extension" } } as never);
    readFiltersMock.mockResolvedValue({
      ...EMPTY_APPLY_FILTERS,
      boardFilters: {
        ...EMPTY_APPLY_FILTERS.boardFilters,
        jobinja: { ...EMPTY_APPLY_FILTERS.boardFilters.jobinja, enabled: false },
        jobvision: { ...EMPTY_APPLY_FILTERS.boardFilters.jobvision, enabled: true },
      },
    });
    claimMock.mockResolvedValue([] as never);
    const executorId = "22222222-2222-4222-8222-222222222222";

    const res = await claimPOST(claimReq({ executorId, limit: 4 }));
    expect(res.status).toBe(200);
    expect(ownerMock).toHaveBeenCalledWith("u-executor", executorId);
    expect(prepareResumeMock).toHaveBeenCalledWith("u-executor", { allowedBoards: ["jobvision"] });
    expect(claimMock).toHaveBeenCalledWith("u-executor", 4, undefined, {
      requireTailoredResume: true,
      allowedBoards: ["jobvision"],
    });
  });

  it("executor با همهٔ providerهای متوقف صف را دست‌نخورده نگه می‌دارد", async () => {
    authMock.mockResolvedValue({ userId: "u-paused", session: { kind: "extension" } } as never);
    readFiltersMock.mockResolvedValue({
      ...EMPTY_APPLY_FILTERS,
      boardFilters: {
        jobinja: { ...EMPTY_APPLY_FILTERS.boardFilters.jobinja, enabled: false },
        jobvision: { ...EMPTY_APPLY_FILTERS.boardFilters.jobvision, enabled: false },
        "e-estekhdam": { ...EMPTY_APPLY_FILTERS.boardFilters["e-estekhdam"], enabled: false },
        irantalent: { ...EMPTY_APPLY_FILTERS.boardFilters.irantalent, enabled: false },
      },
    });

    const res = await claimPOST(claimReq({ executorId: "33333333-3333-4333-8333-333333333333" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 0, reason: "providers_paused" });
    expect(prepareResumeMock).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی خالی هم مجاز است (پیش‌فرض)", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([] as never);
    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    expect(claimMock).toHaveBeenCalledWith("u", 5, undefined, {
      minScore: 0.7,
      allowedBoards: LEGACY_CLAIM_BOARDS,
    });
  });

  it("limit سفارشی رعایت می‌شود", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    claimMock.mockResolvedValue([] as never);
    await claimPOST(claimReq({ limit: 3 }));
    expect(claimMock).toHaveBeenCalledWith("u", 3, undefined, {
      minScore: 0.7,
      allowedBoards: LEGACY_CLAIM_BOARDS,
    });
  });

  it("تاگلِ AI خاموش ⇒ فقط آیتم‌های فیلترمود (بدونِ گیتِ آستانه، بدونِ reason)", async () => {
    // پیوُت محصول: فیلترمودِ پیش‌فرض نیازی به تاگلِ اپلای خودکار ندارد. تاگل خاموش ⇒
    // آیتم‌های فیلترمود همچنان با آستانه‌ی «دست‌نیافتنی» (AIمود حذف) claim می‌شوند.
    authMock.mockResolvedValue({ userId: "u-off", session: { kind: "extension" } } as never);
    autoApplyMock.mockRejectedValue(new AutoApplyNotAllowedError({ code: "disabled" }));
    quotaMock.mockResolvedValue({ limit: 100, usedToday: 0, remaining: 100 });
    claimMock.mockResolvedValue([
      { taskId: "tf", matchId: "mf", mode: "filter", listing: { title: "Filter Job" } },
    ] as never);

    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.items[0].taskId).toBe("tf");
    expect(body.reason).toBeUndefined();
    // آستانه‌ی دست‌نیافتنی ⇒ AIمود حذف، فیلترمود (OR در extension-queue) عبور می‌کند.
    expect(claimMock).toHaveBeenCalledWith("u-off", 5, undefined, {
      minScore: Number.MAX_SAFE_INTEGER,
      allowedBoards: LEGACY_CLAIM_BOARDS,
    });
    // سقفِ روزانه هم برای فیلترمود بررسی شد (قاعده‌ی politeness).
    expect(quotaMock).toHaveBeenCalledWith("u-off");
  });

  it("تاگلِ AI خاموش + سقفِ روزانه پر ⇒ صفِ خالی + reason='quota_exceeded' (هیچ claim)", async () => {
    authMock.mockResolvedValue({ userId: "u-off-cap", session: { kind: "extension" } } as never);
    autoApplyMock.mockRejectedValue(new AutoApplyNotAllowedError({ code: "disabled" }));
    quotaMock.mockRejectedValue(new ApplyQuotaError({ usedToday: 100, limit: 100 }));

    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.reason).toBe("quota_exceeded");
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("سقفِ روزانه پر ⇒ صفِ خالی + reason='quota_exceeded' (هیچ claim)", async () => {
    authMock.mockResolvedValue({ userId: "u-cap", session: { kind: "extension" } } as never);
    autoApplyMock.mockRejectedValue(
      new AutoApplyNotAllowedError({ code: "quota_exceeded", usedToday: 100, limit: 100 }),
    );
    const res = await claimPOST(claimReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.reason).toBe("quota_exceeded");
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("آستانه‌ی کاربر به claim منتقل می‌شود", async () => {
    authMock.mockResolvedValue({ userId: "u-th", session: { kind: "extension" } } as never);
    autoApplyMock.mockResolvedValue({
      minScore: 0.85,
      quota: { limit: null, usedToday: 0, remaining: null },
    });
    claimMock.mockResolvedValue([] as never);
    await claimPOST(claimReq({ limit: 4 }));
    expect(claimMock).toHaveBeenCalledWith("u-th", 4, undefined, {
      minScore: 0.85,
      allowedBoards: LEGACY_CLAIM_BOARDS,
    });
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
