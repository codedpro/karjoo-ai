/**
 * تست‌های هندلرِ `/api/profile/import` (POST) و `/api/profile/imports` (GET).
 *
 * نگهبانِ Bearer و DB کاملاً mock می‌شوند (بدونِ شبکه/DBِ زنده — قاعده‌ی پروژه).
 *
 * تمرکزِ بحرانیِ §10:
 *   • payload فقط داده؛ هر فیلدِ شبیهِ اعتبارنامه → ۴۰۰ و هیچ DB-write.
 *   • userId از *نشست* می‌آید، نه از بدنه (حتی اگر بدنه userId بفرستد، نادیده).
 *   • merge بدونِ clobber: مقادیرِ موجودِ کاربر بازنویسی نمی‌شوند؛ skills union.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  return {
    /** صفِ نتایجِ select (هر فراخوانی یک ردیف‌مجموعه مصرف می‌کند). */
    selectResults: [] as unknown[][],
    profileInsertValues: vi.fn(),
    profileUpdateSet: vi.fn(),
    importInsertValues: vi.fn(),
    /** id برگشتیِ insertِ profile_imports. */
    importInsertId: "import-1",
  };
});

vi.mock("@/lib/api/bearer-auth", () => ({ requireBearerSession: vi.fn() }));
vi.mock("@/db", () => {
  // سازنده‌ی select با thenable و orderBy/limit زنجیره‌ای.
  function makeSelect() {
    const rows = h.selectResults.shift() ?? [];
    const builder: Record<string, unknown> = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => Promise.resolve(rows),
      then: (resolve: (r: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
    };
    return builder;
  }
  return {
    db: {
      select: vi.fn(() => makeSelect()),
      update: vi.fn(() => ({
        set: (v: unknown) => {
          h.profileUpdateSet(v);
          return { where: () => Promise.resolve(undefined) };
        },
      })),
      insert: vi.fn((table: { __name?: string }) => ({
        values: (v: unknown) => {
          // تشخیصِ جدول از روی ارجاع (mockِ schema پایین).
          if (table && (table as { __kind?: string }).__kind === "profile_imports") {
            h.importInsertValues(v);
            return {
              returning: () => Promise.resolve([{ id: h.importInsertId }]),
            };
          }
          h.profileInsertValues(v);
          // پروفایلِ تازه اکنون upsert است: .values(...).onConflictDoUpdate(...).
          return {
            onConflictDoUpdate: () => Promise.resolve(undefined),
          };
        },
      })),
    },
  };
});

// schema را با نشانه‌گذارِ سبک mock می‌کنیم تا insert بتواند جدول را تشخیص دهد.
vi.mock("@/db/schema", () => ({
  candidateProfiles: {
    __kind: "candidate_profiles",
    id: "id",
    userId: "user_id",
    fullName: "full_name",
    headline: "headline",
    skills: "skills",
    yearsExperience: "years_experience",
    city: "city",
    resumeText: "resume_text",
  },
  profileImports: {
    __kind: "profile_imports",
    id: "id",
    userId: "user_id",
    board: "board",
    status: "status",
    appliedFields: "applied_fields",
    createdAt: "created_at",
  },
}));

import { db } from "@/db";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { HttpError } from "@/lib/api/http";
import { POST as importPOST } from "@/app/api/profile/import/route";
import { GET as importsGET } from "@/app/api/profile/imports/route";

const authMock = vi.mocked(requireBearerSession);
const dbInsert = vi.mocked(db.insert);
const dbUpdate = vi.mocked(db.update);

function pushSelect(rows: unknown[]) {
  h.selectResults.push(rows);
}

function importReq(body: unknown) {
  return new Request("https://k.app/api/profile/import", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults.length = 0;
});

describe("POST /api/profile/import — مسیرِ موفق", () => {
  it("پروفایلِ موجود را merge می‌کند (skills union، خالی‌ها پر) و ۲۰۱ می‌دهد", async () => {
    authMock.mockResolvedValue({ userId: "user-1", session: { kind: "extension" } } as never);
    // ۱) selectِ پروفایلِ فعلی: کاربر نام دارد، شهر ندارد، یک مهارت دارد.
    pushSelect([
      {
        id: "prof-1",
        fullName: "نامِ کاربر",
        headline: null,
        skills: ["React"],
        yearsExperience: null,
        city: null,
        resumeText: null,
      },
    ]);

    const res = await importPOST(
      importReq({
        board: "jobinja",
        payload: {
          first_and_last_name: "نامِ ایمپورت", // نباید نامِ کاربر را clobber کند
          field: "توسعه‌دهنده",
          skill_tags: ["React", "Vue"], // React تکراری → فقط Vue اضافه
          resident_city: "تهران",
        },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("applied");
    expect(body.importId).toBe("import-1");
    // fullName چون موجود بود اعمال نشد؛ headline/city/skills اعمال شدند.
    expect(body.appliedFields.sort()).toEqual(["city", "headline", "skills"]);
    expect(body.addedSkills).toEqual(["Vue"]);

    // updateِ پروفایل با مقادیرِ درست (بدونِ fullName).
    const updated = h.profileUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updated.fullName).toBeUndefined();
    expect(updated.headline).toBe("توسعه‌دهنده");
    expect(updated.city).toBe("تهران");
    expect(updated.skills).toEqual(["React", "Vue"]);

    // رکوردِ profile_imports با userIdِ نشست + appliedFields ثبت شد.
    const importRow = h.importInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(importRow.userId).toBe("user-1");
    expect(importRow.board).toBe("jobinja");
    expect(importRow.status).toBe("applied");
  });

  it("کاربرِ بدونِ پروفایل → insertِ پروفایلِ تازه", async () => {
    authMock.mockResolvedValue({ userId: "user-2", session: { kind: "extension" } } as never);
    pushSelect([]); // پروفایلی وجود ندارد

    const res = await importPOST(
      importReq({ board: "jobvision", payload: { resume: { firstName: "علی", lastName: "نوری" } } }),
    );
    expect(res.status).toBe(201);
    const inserted = h.profileInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.userId).toBe("user-2");
    expect(inserted.fullName).toBe("علی نوری");
  });

  it("هیچ فیلدِ قابلِ merge نبود → status='received' و بدونِ update", async () => {
    authMock.mockResolvedValue({ userId: "user-3", session: { kind: "extension" } } as never);
    // کاربر همه‌چیز دارد؛ ایمپورت همان‌ها را می‌فرستد.
    pushSelect([
      {
        id: "prof-3",
        fullName: "علی",
        headline: "بک‌اند",
        skills: ["Go"],
        yearsExperience: 5,
        city: "تهران",
        resumeText: "خلاصه",
      },
    ]);
    const res = await importPOST(
      importReq({ board: "jobinja", payload: { full_name: "علی", skills: ["go"] } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("received");
    expect(body.appliedFields).toEqual([]);
    expect(dbUpdate).not.toHaveBeenCalled();
    // رکوردِ ایمپورت همچنان ثبت می‌شود (برای تاریخچه).
    expect(h.importInsertValues).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/profile/import — §10 ردِ اعتبارنامه", () => {
  it.each([
    ["cookie", { board: "jobinja", payload: { cookie: "a=b" } }],
    ["token تودرتو", { board: "jobinja", payload: { resume: { authToken: "x" } } }],
    ["password", { board: "jobinja", payload: { password: "1234" } }],
    ["sessionBlob", { board: "jobvision", payload: { sessionBlob: "..." } }],
  ])("فیلدِ شبیهِ اعتبارنامه → ۴۰۰ و هیچ DB-write: %s", async (_label, reqBody) => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await importPOST(importReq(reqBody));
    expect(res.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("userId در بدنه نادیده گرفته می‌شود (userId همیشه از نشست)", async () => {
    authMock.mockResolvedValue({ userId: "session-user", session: { kind: "extension" } } as never);
    pushSelect([]);
    await importPOST(
      importReq({ board: "jobinja", payload: { userId: "attacker", full_name: "x" } }),
    );
    // پروفایلِ تازه با userIdِ نشست (نه attacker).
    const inserted = h.profileInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.userId).toBe("session-user");
    const importRow = h.importInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(importRow.userId).toBe("session-user");
  });
});

describe("POST /api/profile/import — احراز هویت", () => {
  it("فقط نشستِ extension — نشستِ نامعتبر → ۴۰۱", async () => {
    authMock.mockRejectedValue(new HttpError(401, "unauthorized"));
    const res = await importPOST(importReq({ board: "jobinja", payload: { full_name: "x" } }));
    expect(res.status).toBe(401);
    expect(authMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireKind: "extension" }),
    );
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("boardِ نامعتبر → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "extension" } } as never);
    const res = await importPOST(importReq({ board: "monster", payload: { full_name: "x" } }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/profile/imports", () => {
  function listReq(qs = "") {
    return new Request(`https://k.app/api/profile/imports${qs}`, {
      headers: { authorization: "Bearer t" },
    });
  }

  it("افزونه یا وب → تاریخچه‌ی همین کاربر (فقط متادیتا)", async () => {
    authMock.mockResolvedValue({ userId: "user-9", session: { kind: "web" } } as never);
    pushSelect([
      { id: "i1", board: "jobinja", status: "applied", appliedFields: { fields: ["city"] }, createdAt: new Date("2026-06-30") },
      { id: "i2", board: "jobvision", status: "received", appliedFields: null, createdAt: new Date("2026-06-29") },
    ]);
    const res = await importsGET(listReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.imports).toHaveLength(2);
    // بدونِ requireKind (وب هم مجاز).
    expect(authMock.mock.calls[0][1]).toBeUndefined();
  });

  it("limitِ نامعتبر در query → ۴۰۰", async () => {
    authMock.mockResolvedValue({ userId: "u", session: { kind: "web" } } as never);
    const res = await importsGET(listReq("?limit=999"));
    expect(res.status).toBe(400);
  });
});
