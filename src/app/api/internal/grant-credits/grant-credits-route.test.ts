/**
 * تست‌های route handlerِ POST /api/internal/grant-credits — فقط «سیم‌کشیِ HTTP».
 *
 * استراتژی: لایه‌ی رازِ داخلی (`@/lib/env#requireInternalSecret`) و اجراگر
 * (`@/lib/billing/grant-runner#runMonthlyGrants`) mock می‌شوند تا گاردِ راز (۴۰۱/۵۰۳)،
 * اعتبارسنجیِ بدنه (۴۰۰)، و عبورِ درستِ userIds به اجراگر آزموده شود. بدونِ DB/شبکه.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// رازِ داخلی را قابلِ‌کنترل می‌کنیم تا گاردِ fail-closed (۵۰۳) و ۴۰۱ هر دو آزموده شوند.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, requireInternalSecret: vi.fn() };
});
vi.mock("@/lib/billing/grant-runner", () => ({ runMonthlyGrants: vi.fn() }));

import { requireInternalSecret } from "@/lib/env";
import { runMonthlyGrants } from "@/lib/billing/grant-runner";
import { POST } from "@/app/api/internal/grant-credits/route";

const secretMock = vi.mocked(requireInternalSecret);
const runMock = vi.mocked(runMonthlyGrants);

const SECRET = "test-internal-secret";

const SUMMARY = {
  period: "2026-06",
  scanned: 3,
  granted: 2,
  skipped: 1,
  ineligible: 0,
  totalGrantedToman: 600_000,
  errors: 0,
};

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://k.app/api/internal/grant-credits", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  secretMock.mockReturnValue(SECRET);
  runMock.mockResolvedValue(SUMMARY);
});

describe("POST /api/internal/grant-credits — گاردِ راز", () => {
  it("بدونِ هدرِ راز → ۴۰۱ و هیچ اجرایی", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("هدرِ رازِ غلط → ۴۰۱", async () => {
    const res = await POST(req({}, { "x-internal-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("رازِ سرور تنظیم نشده → ۵۰۳ (fail-closed)", async () => {
    secretMock.mockImplementation(() => {
      throw new Error("internal disabled");
    });
    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(503);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/grant-credits — اجرا", () => {
  it("بدنه‌ی خالی (همه) → ۲۰۰ + خلاصه، runMonthlyGrants بدونِ userIds", async () => {
    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SUMMARY);
    expect(runMock).toHaveBeenCalledWith({ userIds: undefined });
  });

  it("userIds معتبر → فقط همان‌ها به اجراگر پاس می‌شود", async () => {
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    const res = await POST(
      req({ userIds: ids }, { "x-internal-secret": SECRET }),
    );
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith({ userIds: ids });
  });

  it("userIdِ غیر-UUID → ۴۰۰ و هیچ اجرایی", async () => {
    const res = await POST(
      req({ userIds: ["not-a-uuid"] }, { "x-internal-secret": SECRET }),
    );
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("فیلدِ ناشناخته در بدنه (strict) → ۴۰۰", async () => {
    const res = await POST(
      req({ bogus: true }, { "x-internal-secret": SECRET }),
    );
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("JSONِ نامعتبر → ۴۰۰", async () => {
    const badReq = new Request("https://k.app/api/internal/grant-credits", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": SECRET },
      body: "{not json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });
});
