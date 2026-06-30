/**
 * تست‌های route handlerهای علاقه‌مندی/دسته‌بندی (Track B).
 *
 * استراتژی: لایه‌ی نشست (`@/lib/auth/http#getCurrentUser`) و لایه‌ی store
 * (`@/lib/interests/store`) mock می‌شوند تا فقط «سیم‌کشیِ HTTP» تست شود: گاردِ احراز
 * هویت (۴۰۱)، اعتبارسنجیِ بدنه (۴۰۰)، مقیدسازیِ userId به نشست (نه به بدنه)، و شکلِ
 * پاسخ. بدون DB/شبکه.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/http", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/interests/store", () => ({
  getSelectedSlugs: vi.fn(),
  replaceInterests: vi.fn(),
  getAllCategories: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/http";
import {
  getAllCategories,
  getSelectedSlugs,
  replaceInterests,
} from "@/lib/interests/store";
import { GET as interestsGET, PUT as interestsPUT } from "@/app/api/interests/route";
import { GET as categoriesGET } from "@/app/api/categories/route";

const getUserMock = vi.mocked(getCurrentUser);
const getSelectedSlugsMock = vi.mocked(getSelectedSlugs);
const replaceInterestsMock = vi.mocked(replaceInterests);
const getAllCategoriesMock = vi.mocked(getAllCategories);

const USER = {
  id: "u1",
  phone: "+989121234567",
  fullName: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as never;

function putReq(body: unknown): Request {
  return new Request("https://k.app/api/interests", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/interests", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ خواندنِ DB", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await interestsGET();
    expect(res.status).toBe(401);
    expect(getSelectedSlugsMock).not.toHaveBeenCalled();
  });

  it("با نشست → slugهای همین کاربر (userId از نشست)", async () => {
    getUserMock.mockResolvedValue(USER);
    getSelectedSlugsMock.mockResolvedValue(["software-development", "data-ai"]);

    const res = await interestsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.slugs).toEqual(["software-development", "data-ai"]);
    expect(getSelectedSlugsMock).toHaveBeenCalledWith("u1");
  });
});

describe("PUT /api/interests", () => {
  it("بدونِ نشست → ۴۰۱ و هیچ نوشتنِ DB", async () => {
    getUserMock.mockResolvedValue(null);
    const res = await interestsPUT(putReq({ slugs: ["data-ai"] }));
    expect(res.status).toBe(401);
    expect(replaceInterestsMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی معتبر → جایگزینی و پاسخِ slugهای اعمال‌شده", async () => {
    getUserMock.mockResolvedValue(USER);
    replaceInterestsMock.mockResolvedValue({
      appliedSlugs: ["software-development"],
      count: 1,
    });

    const res = await interestsPUT(
      putReq({ slugs: ["software-development", "bogus"] }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slugs).toEqual(["software-development"]);
    expect(body.count).toBe(1);
    // userId از نشست، slugها از بدنه.
    expect(replaceInterestsMock).toHaveBeenCalledWith("u1", [
      "software-development",
      "bogus",
    ]);
  });

  it("آرایه‌ی خالی مجاز است (پاک‌کردنِ همه)", async () => {
    getUserMock.mockResolvedValue(USER);
    replaceInterestsMock.mockResolvedValue({ appliedSlugs: [], count: 0 });
    const res = await interestsPUT(putReq({ slugs: [] }));
    expect(res.status).toBe(200);
    expect(replaceInterestsMock).toHaveBeenCalledWith("u1", []);
  });

  it("بدنه‌ی نامعتبر (slugs غایب) → ۴۰۰ و هیچ نوشتن", async () => {
    getUserMock.mockResolvedValue(USER);
    const res = await interestsPUT(putReq({ foo: 1 }));
    expect(res.status).toBe(400);
    expect(replaceInterestsMock).not.toHaveBeenCalled();
  });

  it("بدنه‌ی نامعتبر (عضوِ غیررشته) → ۴۰۰", async () => {
    getUserMock.mockResolvedValue(USER);
    const res = await interestsPUT(putReq({ slugs: [123] }));
    expect(res.status).toBe(400);
    expect(replaceInterestsMock).not.toHaveBeenCalled();
  });

  it("JSONِ نامعتبر → ۴۰۰", async () => {
    getUserMock.mockResolvedValue(USER);
    const req = new Request("https://k.app/api/interests", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await interestsPUT(req);
    expect(res.status).toBe(400);
  });

  it("userId از بدنه نادیده گرفته می‌شود (مقیدسازیِ §10)", async () => {
    getUserMock.mockResolvedValue(USER);
    replaceInterestsMock.mockResolvedValue({ appliedSlugs: ["data-ai"], count: 1 });
    await interestsPUT(putReq({ slugs: ["data-ai"], userId: "victim" }));
    // userId همیشه از نشست (u1)، نه از بدنه.
    expect(replaceInterestsMock).toHaveBeenCalledWith("u1", ["data-ai"]);
  });
});

describe("GET /api/categories", () => {
  it("تاکسونومیِ تخت + گروه‌بندی‌شده (عمومی، بدونِ نشست)", async () => {
    getAllCategoriesMock.mockResolvedValue([
      {
        id: "c1",
        slug: "software-development",
        labelFa: "نرم‌افزار",
        labelEn: "Software",
        parentId: null,
        sortOrder: 10,
      },
      {
        id: "c2",
        slug: "data-ai",
        labelFa: "داده",
        labelEn: "Data",
        parentId: null,
        sortOrder: 20,
      },
    ]);

    const res = await categoriesGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.categories).toHaveLength(2);
    // تک‌سطحی → هر دسته یک گروهِ مستقل با parent=null.
    expect(body.groups).toHaveLength(2);
    expect(body.groups[0].parent).toBeNull();
    expect(body.groups[0].categories[0].slug).toBe("software-development");
    // نشست لازم نیست.
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("دسته‌های دارای والد زیرِ گروهِ والد جمع می‌شوند", async () => {
    getAllCategoriesMock.mockResolvedValue([
      {
        id: "p1",
        slug: "engineering",
        labelFa: "مهندسی",
        labelEn: "Engineering",
        parentId: null,
        sortOrder: 10,
      },
      {
        id: "c1",
        slug: "civil-engineering",
        labelFa: "عمران",
        labelEn: "Civil",
        parentId: "p1",
        sortOrder: 20,
      },
    ]);

    const res = await categoriesGET();
    const body = await res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].parent.slug).toBe("engineering");
    expect(body.groups[0].categories[0].slug).toBe("civil-engineering");
  });
});
