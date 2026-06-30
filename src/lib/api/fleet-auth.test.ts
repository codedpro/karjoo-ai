/**
 * تست‌های نگهبانِ احراز هویتِ نودِ کارگر (fleet-auth) — Track A.
 *
 * استراتژی: `verifyNodeCredential` از هسته‌ی fleet/enroll mock می‌شود تا منطقِ
 * استخراجِ اعتبارنامه از هدر + fail-closed (۴۰۱) بدونِ DB/شبکه آزموده شود. خودِ
 * extractNodeCredential/requireNodeCredential منطقِ واقعی‌اند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fleet/enroll", () => ({ verifyNodeCredential: vi.fn() }));

import { verifyNodeCredential } from "@/lib/fleet/enroll";
import { HttpError } from "@/lib/api/http";
import {
  extractNodeCredential,
  requireNodeCredential,
} from "@/lib/api/fleet-auth";
import type { WorkerNode } from "@/db/schema";

const verifyMock = vi.mocked(verifyNodeCredential);

const NODE = { id: "node-1", nodeKey: "k1" } as unknown as WorkerNode;

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://k.app/api/fleet/heartbeat", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractNodeCredential", () => {
  it("از هدرِ Authorization: Bearer استخراج می‌کند", () => {
    expect(extractNodeCredential(req({ authorization: "Bearer cred-abc" }))).toBe(
      "cred-abc",
    );
  });

  it("به کلیدواژه‌ی Bearer حساسِ حروف نیست", () => {
    expect(extractNodeCredential(req({ authorization: "bearer cred-xyz" }))).toBe(
      "cred-xyz",
    );
  });

  it("هدرِ سازگارِ X-Node-Credential را هم می‌پذیرد", () => {
    expect(extractNodeCredential(req({ "x-node-credential": "cred-direct" }))).toBe(
      "cred-direct",
    );
  });

  it("بدونِ هیچ هدری → null", () => {
    expect(extractNodeCredential(req())).toBeNull();
  });

  it("هدرِ Authorizationِ بدشکل (بدونِ Bearer) → null", () => {
    expect(extractNodeCredential(req({ authorization: "Token abc" }))).toBeNull();
  });
});

describe("requireNodeCredential", () => {
  it("اعتبارنامه‌ی معتبر → ردیفِ نود", async () => {
    verifyMock.mockResolvedValue(NODE);
    const node = await requireNodeCredential(req({ authorization: "Bearer ok" }));
    expect(node).toBe(NODE);
    expect(verifyMock).toHaveBeenCalledWith("ok");
  });

  it("بدونِ هدر → HttpError(401) و verify صدا نمی‌شود (fail-closed)", async () => {
    await expect(requireNodeCredential(req())).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("اعتبارنامه‌ی نامعتبر (verify=null) → HttpError(401)", async () => {
    verifyMock.mockResolvedValue(null);
    await expect(
      requireNodeCredential(req({ authorization: "Bearer bad" })),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("override تزریقیِ verify در تست به‌کار می‌رود", async () => {
    const injected = vi.fn().mockResolvedValue(NODE);
    const node = await requireNodeCredential(
      req({ "x-node-credential": "z" }),
      { verify: injected },
    );
    expect(node).toBe(NODE);
    expect(injected).toHaveBeenCalledWith("z");
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
