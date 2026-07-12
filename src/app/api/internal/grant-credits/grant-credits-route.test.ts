/**
 * تست‌های route handlerِ POST /api/internal/grant-credits — *بازنشسته* (۴۱۰).
 *
 * استراتژی: لایه‌ی رازِ داخلی (`@/lib/env#requireInternalSecret`) mock می‌شود تا گاردِ
 * راز (۴۰۱/۵۰۳ — fail-closed) هنوز *قبل از* ۴۱۰ آزموده شود؛ با رازِ درست مسیر همیشه
 * ۴۱۰ می‌دهد (گرنتِ ماهانه با کیف‌پولِ واحدِ 1xai حذف شده — پیام به 1xai اشاره می‌کند).
 * بدونِ DB/شبکه.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// رازِ داخلی را قابلِ‌کنترل می‌کنیم تا گاردِ fail-closed (۵۰۳) و ۴۰۱ هر دو آزموده شوند.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, requireInternalSecret: vi.fn() };
});

import { requireInternalSecret } from "@/lib/env";
import { POST } from "@/app/api/internal/grant-credits/route";

const secretMock = vi.mocked(requireInternalSecret);

const SECRET = "test-internal-secret";

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
});

describe("POST /api/internal/grant-credits — گاردِ راز (هنوز قبل از ۴۱۰)", () => {
  it("بدونِ هدرِ راز → ۴۰۱ (نه ۴۱۰ — مسیر برای بیرونی‌ها probe‌پذیر نیست)", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  it("هدرِ رازِ غلط → ۴۰۱", async () => {
    const res = await POST(req({}, { "x-internal-secret": "wrong" }));
    expect(res.status).toBe(401);
  });

  it("رازِ سرور تنظیم نشده → ۵۰۳ (fail-closed)", async () => {
    secretMock.mockImplementation(() => {
      throw new Error("internal disabled");
    });
    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/internal/grant-credits — بازنشسته", () => {
  it("رازِ درست → همیشه ۴۱۰ + پیامِ ارجاع به کیف‌پولِ واحدِ 1xai", async () => {
    const res = await POST(req({}, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("1xai");
  });

  it("بدنه‌ی خالی (کرانِ قدیمیِ curl -X POST بدونِ body) هم ۴۱۰ — نه ۴۰۰/۲۰۰", async () => {
    const res = await POST(req(undefined, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(410);
  });

  it("بدنه با userIds (فراخوانِ هدف‌مندِ قدیمی) هم ۴۱۰ — هیچ اجرایی", async () => {
    const res = await POST(
      req(
        { userIds: ["11111111-1111-4111-8111-111111111111"] },
        { "x-internal-secret": SECRET },
      ),
    );
    expect(res.status).toBe(410);
  });
});
