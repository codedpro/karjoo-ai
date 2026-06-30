/**
 * تست‌های واحدِ اسکیماهای افزونه/board-accounts/apply-queue.
 *
 * تمرکزِ بحرانی: قاعده‌ی ایمنیِ ۱ — اسکیمای connect هر فیلدِ سری/ناشناخته
 * (cookie/token/password/credential) را رد می‌کند تا مادهٔ سری هرگز پذیرفته نشود.
 */
import { describe, expect, it } from "vitest";

import {
  applyQueueClaimBodySchema,
  applyQueueResultBodySchema,
  boardConnectBodySchema,
  extensionLinkBodySchema,
  taskIdParamSchema,
} from "@/lib/api/extension-schemas";

describe("extensionLinkBodySchema", () => {
  it("pairingCode معتبر را می‌پذیرد", () => {
    expect(extensionLinkBodySchema.parse({ pairingCode: "abc123" }).pairingCode).toBe(
      "abc123",
    );
  });

  it("بدونِ pairingCode → خطا", () => {
    expect(extensionLinkBodySchema.safeParse({}).success).toBe(false);
  });

  it("فیلدِ اضافی → خطا (strict)", () => {
    expect(
      extensionLinkBodySchema.safeParse({ pairingCode: "x", token: "raw" }).success,
    ).toBe(false);
  });
});

describe("boardConnectBodySchema — قاعده‌ی ایمنیِ ۱ (فقط متادیتا)", () => {
  it("board + accountLabel معتبر را می‌پذیرد", () => {
    const r = boardConnectBodySchema.parse({ board: "jobinja", accountLabel: "me" });
    expect(r.board).toBe("jobinja");
    expect(r.accountLabel).toBe("me");
  });

  it("accountLabel اختیاری است", () => {
    expect(boardConnectBodySchema.parse({ board: "jobvision" }).board).toBe("jobvision");
  });

  it("فیلدِ cookie را رد می‌کند (مادهٔ سری ممنوع)", () => {
    expect(
      boardConnectBodySchema.safeParse({ board: "jobinja", cookie: "session=xyz" })
        .success,
    ).toBe(false);
  });

  it("فیلدِ token را رد می‌کند", () => {
    expect(
      boardConnectBodySchema.safeParse({ board: "jobinja", token: "JWT..." }).success,
    ).toBe(false);
  });

  it("فیلدِ password/credentials را رد می‌کند", () => {
    expect(
      boardConnectBodySchema.safeParse({ board: "jobinja", password: "p" }).success,
    ).toBe(false);
    expect(
      boardConnectBodySchema.safeParse({
        board: "jobinja",
        credentials: { a: 1 },
      }).success,
    ).toBe(false);
  });

  it("boardِ نامعتبر → خطا", () => {
    expect(boardConnectBodySchema.safeParse({ board: "indeed" }).success).toBe(false);
  });
});

describe("applyQueueClaimBodySchema", () => {
  it("بدنه‌ی undefined → پیش‌فرضِ limit=5", () => {
    expect(applyQueueClaimBodySchema.parse(undefined).limit).toBe(5);
  });

  it("limit سفارشی را می‌پذیرد", () => {
    expect(applyQueueClaimBodySchema.parse({ limit: 10 }).limit).toBe(10);
  });

  it("limit خارج از بازه → خطا", () => {
    expect(applyQueueClaimBodySchema.safeParse({ limit: 100 }).success).toBe(false);
    expect(applyQueueClaimBodySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe("applyQueueResultBodySchema", () => {
  it("status معتبر را می‌پذیرد", () => {
    expect(applyQueueResultBodySchema.parse({ status: "submitted" }).status).toBe(
      "submitted",
    );
  });

  it("فیلدهای اختیاری externalRef/reason/proof را می‌پذیرد", () => {
    const r = applyQueueResultBodySchema.parse({
      status: "failed",
      reason: "captcha",
      externalRef: "ref-1",
      proof: { httpStatus: 200 },
    });
    expect(r.reason).toBe("captcha");
    expect(r.proof).toEqual({ httpStatus: 200 });
  });

  it("statusِ نامعتبر → خطا", () => {
    expect(applyQueueResultBodySchema.safeParse({ status: "queued" }).success).toBe(
      false,
    );
  });

  it("فیلدِ ناشناخته → خطا (strict)", () => {
    expect(
      applyQueueResultBodySchema.safeParse({ status: "submitted", cookie: "x" }).success,
    ).toBe(false);
  });
});

describe("taskIdParamSchema", () => {
  it("UUID معتبر را می‌پذیرد", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(taskIdParamSchema.parse({ id }).id).toBe(id);
  });

  it("idِ غیرUUID → خطا", () => {
    expect(taskIdParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
