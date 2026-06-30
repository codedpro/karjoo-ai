/**
 * تست‌های route handlerهای کاتالوگِ مدل + تنظیماتِ هوش مصنوعی (Track A).
 *
 * استراتژی: لایه‌ی نشست (`@/lib/auth/http#getCurrentUser`) و لایه‌ی store
 * (`@/lib/ai-settings/store`) mock می‌شوند تا فقط «سیم‌کشیِ HTTP» تست شود: گاردِ احراز
 * هویت (۴۰۱)، اعتبارسنجیِ بدنه (۴۰۰)، مدلِ نامعتبر (۴۲۲)، مقیدسازیِ userId به نشست
 * (نه به بدنه)، و شکلِ پاسخ. بدون DB/شبکه.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
// فقط توابعِ DB-محور را mock می‌کنیم؛ توابعِ خالص (groupByProvider/recommendedModelId)
// واقعی می‌مانند تا route واقعاً همان منطقِ گروه‌بندی/recommended را اجرا کند.
vi.mock("@/lib/ai-settings/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ai-settings/store")>();
  return {
    ...actual,
    getEnabledCatalog: vi.fn(),
    getUserModelSelection: vi.fn(),
    setUserModel: vi.fn(),
  };
});

import { getCurrentUser } from "@/lib/auth/http";
import {
  getEnabledCatalog,
  getUserModelSelection,
  setUserModel,
  type CatalogModel,
} from "@/lib/ai-settings/store";
import { GET as modelsGET } from "@/app/api/models/route";
import {
  GET as settingsGET,
  PUT as settingsPUT,
} from "@/app/api/ai-settings/route";

const getUserMock = vi.mocked(getCurrentUser);
const getCatalogMock = vi.mocked(getEnabledCatalog);
const getSelectionMock = vi.mocked(getUserModelSelection);
const setModelMock = vi.mocked(setUserModel);

const USER = {
  id: "u1",
  phone: "+989121234567",
  fullName: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

const CATALOG: CatalogModel[] = [
  {
    modelId: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    inputPer1kToman: 90,
    outputPer1kToman: 360,
    contextWindow: 128_000,
    tags: ["recommended", "cheap", "fast", "persian"],
  },
  {
    modelId: "claude-3-5-haiku",
    provider: "anthropic",
    displayName: "Claude 3.5 Haiku",
    inputPer1kToman: 480,
    outputPer1kToman: 2_400,
    contextWindow: 200_000,
    tags: ["recommended", "persian"],
  },
];

function putReq(body: unknown): Request {
  return new Request("https://k.app/api/ai-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/models", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ خواندنِ کاتالوگ", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await modelsGET();
    expect(res.status).toBe(401);
    expect(getCatalogMock).not.toHaveBeenCalled();
  });

  it("با نشست → کاتالوگِ گروه‌بندی‌شده + recommended + انتخابِ همین کاربر", async () => {
    getUserMock.mockResolvedValue(USER);
    getCatalogMock.mockResolvedValue(CATALOG);
    getSelectionMock.mockResolvedValue({
      provider: "anthropic",
      modelId: "claude-3-5-haiku",
      isDefault: false,
    });

    const res = await modelsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    // گروه‌بندی بر اساسِ provider به ترتیبِ openai سپس anthropic.
    expect(body.groups.map((g: { provider: string }) => g.provider)).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(body.recommendedModelId).toBe("gpt-4o-mini");
    expect(body.selectedModelId).toBe("claude-3-5-haiku");
    expect(body.isDefaultSelection).toBe(false);
    // انتخاب با userIdِ نشست خوانده شد.
    expect(getSelectionMock).toHaveBeenCalledWith("u1");
  });

  it("کاتالوگِ خالی → groups خالی و selectedModelId null", async () => {
    getUserMock.mockResolvedValue(USER);
    getCatalogMock.mockResolvedValue([]);
    getSelectionMock.mockResolvedValue(null);

    const res = await modelsGET();
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.groups).toEqual([]);
    expect(body.recommendedModelId).toBeNull();
    expect(body.selectedModelId).toBeNull();
    // وقتی انتخابی نیست، پیش‌فرض true است.
    expect(body.isDefaultSelection).toBe(true);
  });
});

describe("GET /api/ai-settings", () => {
  it("بدونِ نشست → ۴۰۱", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await settingsGET();
    expect(res.status).toBe(401);
    expect(getSelectionMock).not.toHaveBeenCalled();
  });

  it("انتخابِ صریحِ کاربر را برمی‌گرداند (userId از نشست)", async () => {
    getUserMock.mockResolvedValue(USER);
    getSelectionMock.mockResolvedValue({
      provider: "openai",
      modelId: "gpt-4o-mini",
      isDefault: false,
    });
    const res = await settingsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
      isDefault: false,
    });
    expect(getSelectionMock).toHaveBeenCalledWith("u1");
  });

  it("کاتالوگِ خالی (انتخابِ null) → modelId null", async () => {
    getUserMock.mockResolvedValue(USER);
    getSelectionMock.mockResolvedValue(null);
    const res = await settingsGET();
    const body = await res.json();
    expect(body.modelId).toBeNull();
    expect(body.provider).toBeNull();
  });
});

describe("PUT /api/ai-settings", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ نوشتن", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await settingsPUT(putReq({ modelId: "gpt-4o-mini" }));
    expect(res.status).toBe(401);
    expect(setModelMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی معتبر → ذخیره و پاسخِ انتخابِ ذخیره‌شده", async () => {
    getUserMock.mockResolvedValue(USER);
    setModelMock.mockResolvedValue({
      ok: true,
      selection: { provider: "openai", modelId: "gpt-4o-mini" },
    });
    const res = await settingsPUT(putReq({ modelId: "gpt-4o-mini" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
      isDefault: false,
    });
    // userId از نشست، modelId از بدنه.
    expect(setModelMock).toHaveBeenCalledWith("u1", "gpt-4o-mini");
  });

  it("مدلِ ناشناخته/غیرفعال → ۴۲۲", async () => {
    getUserMock.mockResolvedValue(USER);
    setModelMock.mockResolvedValue({ ok: false, reason: "model_not_found" });
    const res = await settingsPUT(putReq({ modelId: "bogus-model" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("بدنه‌ی نامعتبر (modelId غایب) → ۴۰۰ و هیچ نوشتن", async () => {
    getUserMock.mockResolvedValue(USER);
    const res = await settingsPUT(putReq({ foo: 1 }));
    expect(res.status).toBe(400);
    expect(setModelMock).not.toHaveBeenCalled();
  });

  it("modelIdِ خالی → ۴۰۰", async () => {
    getUserMock.mockResolvedValue(USER);
    const res = await settingsPUT(putReq({ modelId: "  " }));
    expect(res.status).toBe(400);
    expect(setModelMock).not.toHaveBeenCalled();
  });

  it("JSONِ نامعتبر → ۴۰۰", async () => {
    getUserMock.mockResolvedValue(USER);
    const req = new Request("https://k.app/api/ai-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await settingsPUT(req);
    expect(res.status).toBe(400);
  });

  it("userId/provider از بدنه نادیده گرفته می‌شوند (مقیدسازیِ §10)", async () => {
    getUserMock.mockResolvedValue(USER);
    setModelMock.mockResolvedValue({
      ok: true,
      selection: { provider: "openai", modelId: "gpt-4o-mini" },
    });
    await settingsPUT(
      putReq({ modelId: "gpt-4o-mini", userId: "victim", provider: "anthropic" }),
    );
    // فقط (userId نشست، modelId بدنه) — provider/userIdِ بدنه نادیده.
    expect(setModelMock).toHaveBeenCalledWith("u1", "gpt-4o-mini");
  });
});
